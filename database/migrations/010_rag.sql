-- FitOS retrieval: gte-small embeddings (384 dims, generated in edge functions), hybrid food search,
-- semantic cache for text analyses, and coach memory.
-- Apply after 009_nutrition_pipeline.sql.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(384),
  ADD COLUMN IF NOT EXISTS embedded_text TEXT;
CREATE INDEX IF NOT EXISTS foods_embedding_hnsw_idx ON public.foods USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.food_analyses
  ADD COLUMN IF NOT EXISTS input_embedding extensions.vector(384),
  ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS candidates_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
CREATE INDEX IF NOT EXISTS food_analyses_embedding_hnsw_idx ON public.food_analyses
  USING hnsw (input_embedding extensions.vector_cosine_ops)
  WHERE status IN ('confirmed', 'edited');

CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 280),
  embedding extensions.vector(384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_memory_user_idx ON public.coach_memory (user_id, created_at DESC);
ALTER TABLE public.coach_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY coach_memory_owner ON public.coach_memory
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Keeping embeddings fresh: anything that changes what a food "means" clears its embedding,
-- and the embed-worker refills it. Foods created from the client never carry an embedding.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.foods_reset_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'user' AND auth.uid() IS NOT NULL THEN
      NEW.embedding := NULL;
      NEW.embedded_text := NULL;
    END IF;
  ELSIF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.aliases IS DISTINCT FROM OLD.aliases
     OR NEW.cuisine IS DISTINCT FROM OLD.cuisine
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    IF NEW.embedding IS NOT DISTINCT FROM OLD.embedding THEN
      NEW.embedding := NULL;
      NEW.embedded_text := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS foods_reset_embedding ON public.foods;
CREATE TRIGGER foods_reset_embedding
  BEFORE INSERT OR UPDATE ON public.foods
  FOR EACH ROW EXECUTE FUNCTION private.foods_reset_embedding();

CREATE OR REPLACE FUNCTION private.dish_ingredients_reset_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.foods SET embedding = NULL, embedded_text = NULL
  WHERE id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.dish_food_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.dish_food_id END
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dish_ingredients_reset_embedding ON public.dish_ingredients;
CREATE TRIGGER dish_ingredients_reset_embedding
  AFTER INSERT OR UPDATE OR DELETE ON public.dish_ingredients
  FOR EACH ROW EXECUTE FUNCTION private.dish_ingredients_reset_embedding();

-- Text that represents a food in vector space: name, aliases, cuisine, category,
-- top ingredients for dishes, and common serving units.
CREATE OR REPLACE FUNCTION public.foods_to_embed(p_limit INTEGER DEFAULT 100, p_ids UUID[] DEFAULT NULL)
RETURNS TABLE (id UUID, embedded_text TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id,
    concat_ws('. ',
      f.name,
      NULLIF(array_to_string(f.aliases, ', '), ''),
      CASE WHEN f.cuisine IS NOT NULL THEN replace(f.cuisine, '_', ' ') || ' cuisine' END,
      f.category,
      CASE WHEN f.is_dish THEN 'dish' ELSE 'ingredient' END,
      (SELECT 'made with ' || string_agg(i.name, ', ' ORDER BY di.grams_per_serving DESC)
       FROM (SELECT * FROM public.dish_ingredients x WHERE x.dish_food_id = f.id ORDER BY x.grams_per_serving DESC LIMIT 6) di
       JOIN public.foods i ON i.id = di.ingredient_food_id),
      (SELECT 'served by ' || string_agg(DISTINCT s.unit, ', ')
       FROM public.food_servings s
       WHERE s.food_id = f.id OR (s.food_id IS NULL AND s.applies_to IS NOT NULL AND f.search_text LIKE '%' || s.applies_to || '%'))
    )
  FROM public.foods f
  WHERE (p_ids IS NULL AND f.embedding IS NULL) OR f.id = ANY (p_ids)
  ORDER BY f.created_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- Hybrid retrieval: vector similarity + trigram/full-text, fused with Reciprocal Rank Fusion.
-- SECURITY INVOKER: only the caller's own foods and global foods are visible.
-- score (0..1) = max(name match, 0.6 * rescaled vector + 0.4 * name match) plus boosts; thresholds compare
-- against it. Name match is trigram similarity to the name, its head before the first comma (IFCT style),
-- or any alias. Results are ordered by score; RRF (vector rank + text rank) builds the candidate pool and breaks ties.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_foods(
  query_text TEXT,
  query_embedding extensions.vector(384) DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  k INTEGER DEFAULT 15,
  p_cuisine TEXT DEFAULT NULL
)
RETURNS TABLE (
  food_id UUID,
  name TEXT,
  cuisine TEXT,
  source TEXT,
  verified BOOLEAN,
  is_dish BOOLEAN,
  is_own BOOLEAN,
  kcal NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  fibre_g NUMERIC,
  serving_grams NUMERIC,
  servings JSONB,
  score DOUBLE PRECISION,
  rrf DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  WITH params AS (
    SELECT COALESCE(p_user_id, auth.uid()) AS uid, lower(trim(COALESCE(query_text, ''))) AS q
  ),
  visible AS (
    SELECT f.*
    FROM public.foods f, params p
    WHERE (f.owner_id IS NULL OR f.owner_id = p.uid)
      AND (
        p_cuisine IS NULL OR NOT f.is_dish OR f.cuisine IS NULL OR f.cuisine = 'other' OR f.cuisine = p_cuisine
        OR (p_cuisine LIKE '%indian' AND f.cuisine LIKE '%indian')
      )
  ),
  vec AS (
    SELECT v.id, (1 - (v.embedding <=> query_embedding))::float8 AS sim,
      row_number() OVER (ORDER BY v.embedding <=> query_embedding) AS r
    FROM visible v
    WHERE query_embedding IS NOT NULL AND v.embedding IS NOT NULL
    ORDER BY v.embedding <=> query_embedding
    LIMIT 60
  ),
  txt AS (
    SELECT t.id, t.sim, row_number() OVER (ORDER BY t.sim DESC) AS r
    FROM (
      SELECT v.id,
        GREATEST(similarity(v.search_text, p.q), word_similarity(p.q, v.search_text),
                 CASE WHEN v.search @@ plainto_tsquery('simple', p.q) THEN 0.6 ELSE 0 END)::float8 AS sim
      FROM visible v, params p
      WHERE p.q <> '' AND (v.search_text % p.q OR p.q <% v.search_text OR v.search @@ plainto_tsquery('simple', p.q))
    ) t
    ORDER BY t.sim DESC
    LIMIT 60
  ),
  fused AS (
    SELECT COALESCE(vec.id, txt.id) AS id,
      COALESCE(1.0 / (60 + vec.r), 0) + COALESCE(1.0 / (60 + txt.r), 0) AS rrf,
      -- gte-small puts unrelated foods around 0.80-0.87 and true matches around 0.87-0.95, so rescale.
      LEAST(1.0, GREATEST(0.0, (COALESCE(vec.sim, 0) - 0.80) / 0.15)) AS vec_norm
    FROM vec FULL OUTER JOIN txt ON txt.id = vec.id
  ),
  named AS (
    SELECT fu.*,
      GREATEST(
        similarity(lower(f.name), p.q),
        similarity(lower(split_part(f.name, ',', 1)), p.q),
        COALESCE((SELECT max(similarity(lower(a), p.q)) FROM unnest(f.aliases) a), 0)
      )::float8 AS name_sim
    FROM fused fu JOIN public.foods f ON f.id = fu.id, params p
  ),
  boosted AS (
    SELECT fu.rrf, GREATEST(fu.name_sim, 0.6 * fu.vec_norm + 0.4 * fu.name_sim) AS base, f.*,
      (f.owner_id IS NOT NULL) AS own,
      EXISTS (
        SELECT 1 FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id, params p
        WHERE m.user_id = p.uid AND mi.food_id = f.id AND m.log_date >= current_date - 14
      ) AS recent
    FROM named fu JOIN visible f ON f.id = fu.id
  )
  SELECT
    b.id, b.name, b.cuisine, b.source, b.verified, b.is_dish, b.own,
    n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g, b.serving_grams,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', s.unit, 'grams', s.grams, 'label', s.label) ORDER BY s.food_id NULLS LAST, s.grams), '[]'::jsonb)
      FROM public.food_servings s
      WHERE s.food_id = b.id OR (s.food_id IS NULL AND (s.applies_to IS NULL OR b.search_text LIKE '%' || s.applies_to || '%'))
    ),
    LEAST(1.0, b.base
      + CASE WHEN b.own THEN 0.08 WHEN b.verified OR b.source IN ('ifct', 'verified') THEN 0.04 ELSE 0 END
      + CASE WHEN b.recent THEN 0.03 ELSE 0 END)::float8,
    (b.rrf
      + CASE WHEN b.own THEN 0.010 WHEN b.verified OR b.source IN ('ifct', 'verified') THEN 0.005 ELSE 0 END
      + CASE WHEN b.recent THEN 0.004 ELSE 0 END)::float8
  FROM boosted b
  LEFT JOIN public.food_nutrition n ON n.food_id = b.id
  ORDER BY 15 DESC, 16 DESC
  LIMIT LEAST(GREATEST(COALESCE(k, 15), 1), 50);
$$;

-- Semantic cache: the caller's own confirmed text analyses.
CREATE OR REPLACE FUNCTION public.match_analysis_cache(query_embedding extensions.vector(384), min_similarity DOUBLE PRECISION DEFAULT 0.95)
RETURNS TABLE (id UUID, draft JSONB, input_text TEXT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT a.id, a.draft, a.input_text, (1 - (a.input_embedding <=> query_embedding))::float8
  FROM public.food_analyses a
  WHERE a.user_id = auth.uid() AND a.input_type = 'text' AND a.status IN ('confirmed', 'edited') AND a.input_embedding IS NOT NULL
    AND (1 - (a.input_embedding <=> query_embedding)) >= min_similarity
  ORDER BY a.input_embedding <=> query_embedding
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.match_coach_memory(query_embedding extensions.vector(384), k INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, note TEXT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT m.id, m.note, CASE WHEN m.embedding IS NULL THEN 0 ELSE (1 - (m.embedding <=> query_embedding))::float8 END
  FROM public.coach_memory m
  WHERE m.user_id = auth.uid()
  ORDER BY m.embedding <=> query_embedding NULLS LAST, m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(k, 5), 1), 20);
$$;

REVOKE ALL ON FUNCTION public.match_foods(TEXT, extensions.vector, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_analysis_cache(extensions.vector, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_coach_memory(extensions.vector, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.foods_to_embed(INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_foods(TEXT, extensions.vector, UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_analysis_cache(extensions.vector, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_coach_memory(extensions.vector, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.foods_to_embed(INTEGER, UUID[]) TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
