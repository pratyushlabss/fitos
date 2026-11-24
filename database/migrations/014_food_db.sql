-- FitOS food database (fitos_food_db/) mapped onto the existing tables: foods, food_nutrition, food_servings,
-- dish_ingredients and foods.embedding. No duplicate tables.

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT,
  ADD COLUMN IF NOT EXISTS energy_check TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS embed_text TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Sources in the food DB are free text (IFCT 2017, USDA FDC, BLS, recipe, community, ...).
ALTER TABLE public.foods DROP CONSTRAINT IF EXISTS foods_source_check;

UPDATE public.foods SET tier = CASE
    WHEN owner_id IS NOT NULL THEN 'user'
    WHEN source IN ('verified', 'ifct') OR verified THEN 'lab_verified'
    WHEN source = 'ai' THEN 'ai_estimate'
    ELSE 'community'
  END
WHERE tier IS NULL;

ALTER TABLE public.foods ALTER COLUMN tier SET DEFAULT 'community';
ALTER TABLE public.foods DROP CONSTRAINT IF EXISTS foods_tier_check;
ALTER TABLE public.foods ADD CONSTRAINT foods_tier_check CHECK (tier IN ('user', 'recipe_calculated', 'lab_verified', 'community', 'ai_estimate'));
ALTER TABLE public.foods DROP CONSTRAINT IF EXISTS foods_energy_check_check;
ALTER TABLE public.foods ADD CONSTRAINT foods_energy_check_check CHECK (energy_check IS NULL OR energy_check IN ('ok', 'flag'));
CREATE UNIQUE INDEX IF NOT EXISTS foods_external_id_key ON public.foods (external_id) WHERE external_id IS NOT NULL;

-- A user's own foods are always tier 'user'; barcode rows are community data.
CREATE OR REPLACE FUNCTION private.foods_tier_default()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    NEW.tier := 'user';
  ELSIF NEW.tier IS NULL OR (TG_OP = 'INSERT' AND NEW.tier = 'community' AND NEW.source = 'ai') THEN
    NEW.tier := CASE WHEN NEW.source = 'ai' THEN 'ai_estimate' ELSE 'community' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS foods_tier_default ON public.foods;
CREATE TRIGGER foods_tier_default BEFORE INSERT OR UPDATE OF owner_id, tier ON public.foods
  FOR EACH ROW EXECUTE FUNCTION private.foods_tier_default();


-- Embeddings: the food DB's embed_text wins when present.
CREATE OR REPLACE FUNCTION public.foods_to_embed(p_limit INTEGER DEFAULT 100, p_ids UUID[] DEFAULT NULL)
RETURNS TABLE (id UUID, embedded_text TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.id,
    COALESCE(NULLIF(f.embed_text, ''), concat_ws('. ',
      f.name,
      NULLIF(array_to_string(f.aliases, ', '), ''),
      CASE WHEN f.cuisine IS NOT NULL THEN replace(f.cuisine, '_', ' ') || ' cuisine' END,
      f.category,
      CASE WHEN f.is_dish THEN 'dish' ELSE 'ingredient' END,
      (SELECT 'made with ' || string_agg(i.name, ', ' ORDER BY di.grams_per_serving DESC)
       FROM (SELECT * FROM public.dish_ingredients x WHERE x.dish_food_id = f.id ORDER BY x.grams_per_serving DESC LIMIT 6) di
       JOIN public.foods i ON i.id = di.ingredient_food_id)))
  FROM public.foods f
  WHERE (p_ids IS NULL AND f.embedding IS NULL) OR f.id = ANY (p_ids)
  ORDER BY f.created_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.foods_to_embed(INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.foods_to_embed(INTEGER, UUID[]) TO service_role;

-- Hybrid search with tier priority.
-- name score = max(trigram similarity to the name or its head, word_similarity(query, aliases)).
-- score = max(name score, 0.6 x rescaled vector + 0.4 x name score) + tier bonus, so a community row never
-- outranks a lab or recipe match with a similar score. RRF (vector rank + text rank) breaks ties.
DROP FUNCTION IF EXISTS public.match_foods(TEXT, extensions.vector, UUID, INTEGER, TEXT);
CREATE FUNCTION public.match_foods(
  query_text TEXT,
  query_embedding extensions.vector(384) DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  k INTEGER DEFAULT 15,
  p_cuisine TEXT DEFAULT NULL
)
RETURNS TABLE (
  food_id UUID, name TEXT, cuisine TEXT, source TEXT, verified BOOLEAN, is_dish BOOLEAN, is_own BOOLEAN,
  kcal NUMERIC, protein_g NUMERIC, carbs_g NUMERIC, fat_g NUMERIC, fibre_g NUMERIC, serving_grams NUMERIC,
  servings JSONB, score DOUBLE PRECISION, rrf DOUBLE PRECISION,
  tier TEXT, energy_check TEXT, source_ref TEXT, external_id TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  WITH params AS (
    SELECT COALESCE(p_user_id, auth.uid()) AS uid, lower(trim(COALESCE(query_text, ''))) AS q
  ),
  visible AS (
    SELECT f.* FROM public.foods f, params p
    WHERE (f.owner_id IS NULL OR f.owner_id = p.uid)
      AND (p_cuisine IS NULL OR NOT f.is_dish OR f.cuisine IS NULL OR f.cuisine = 'other' OR f.cuisine = p_cuisine
           OR (p_cuisine LIKE '%indian' AND f.cuisine LIKE '%indian'))
  ),
  vec AS (
    SELECT v.id, (1 - (v.embedding <=> query_embedding))::float8 AS sim, row_number() OVER (ORDER BY v.embedding <=> query_embedding) AS r
    FROM visible v WHERE query_embedding IS NOT NULL AND v.embedding IS NOT NULL
    ORDER BY v.embedding <=> query_embedding LIMIT 60
  ),
  txt AS (
    SELECT t.id, t.sim, row_number() OVER (ORDER BY t.sim DESC) AS r
    FROM (
      SELECT v.id, GREATEST(similarity(v.search_text, p.q), word_similarity(p.q, v.search_text),
                            CASE WHEN v.search @@ plainto_tsquery('simple', p.q) THEN 0.6 ELSE 0 END)::float8 AS sim
      FROM visible v, params p
      WHERE p.q <> '' AND (v.search_text % p.q OR p.q <% v.search_text OR v.search @@ plainto_tsquery('simple', p.q))
    ) t ORDER BY t.sim DESC LIMIT 80
  ),
  fused AS (
    SELECT COALESCE(vec.id, txt.id) AS id,
      COALESCE(1.0 / (60 + vec.r), 0) + COALESCE(1.0 / (60 + txt.r), 0) AS rrf,
      LEAST(1.0, GREATEST(0.0, (COALESCE(vec.sim, 0) - 0.80) / 0.15)) AS vec_norm
    FROM vec FULL OUTER JOIN txt ON txt.id = vec.id
  ),
  named AS (
    SELECT fu.*, GREATEST(
        similarity(lower(f.name), p.q),
        similarity(lower(split_part(f.name, ',', 1)), p.q),
        COALESCE((SELECT max(similarity(lower(a), p.q)) FROM unnest(f.aliases) a), 0),
        CASE WHEN COALESCE(array_length(f.aliases, 1), 0) > 0 THEN word_similarity(p.q, lower(array_to_string(f.aliases, ' | '))) ELSE 0 END
      )::float8 AS name_sim
    FROM fused fu JOIN public.foods f ON f.id = fu.id, params p
  ),
  boosted AS (
    SELECT fu.rrf, GREATEST(fu.name_sim, 0.6 * fu.vec_norm + 0.4 * fu.name_sim) AS base, f.*,
      (f.owner_id IS NOT NULL) AS own,
      EXISTS (SELECT 1 FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id, params p
              WHERE m.user_id = p.uid AND mi.food_id = f.id AND m.log_date >= current_date - 14) AS recent
    FROM named fu JOIN visible f ON f.id = fu.id
  )
  SELECT b.id, b.name, b.cuisine, b.source, b.verified, b.is_dish, b.own,
    n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g, b.serving_grams,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', s.unit, 'grams', s.grams, 'label', s.label) ORDER BY s.food_id NULLS LAST, s.grams), '[]'::jsonb)
     FROM public.food_servings s
     WHERE s.food_id = b.id OR (s.food_id IS NULL AND (s.applies_to IS NULL OR b.search_text LIKE '%' || s.applies_to || '%'))),
    LEAST(1.0, b.base
      + CASE b.tier WHEN 'user' THEN 0.08 WHEN 'recipe_calculated' THEN 0.05 WHEN 'lab_verified' THEN 0.04 WHEN 'ai_estimate' THEN -0.03 ELSE 0 END
      + CASE WHEN b.recent THEN 0.02 ELSE 0 END)::float8,
    (b.rrf + CASE b.tier WHEN 'user' THEN 0.010 WHEN 'recipe_calculated' THEN 0.007 WHEN 'lab_verified' THEN 0.005 ELSE 0 END)::float8,
    b.tier, b.energy_check, b.source_ref, b.external_id
  FROM boosted b
  LEFT JOIN public.food_nutrition n ON n.food_id = b.id
  ORDER BY 15 DESC, 16 DESC
  LIMIT LEAST(GREATEST(COALESCE(k, 15), 1), 50);
$$;
GRANT EXECUTE ON FUNCTION public.match_foods(TEXT, extensions.vector, UUID, INTEGER, TEXT) TO authenticated, service_role;

-- Food vocabulary for the no-hallucination gate: every word in global and the caller's own food names and aliases.
CREATE OR REPLACE FUNCTION public.food_vocabulary()
RETURNS TABLE (word TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT w FROM (
    SELECT regexp_split_to_table(lower(f.name || ' ' || array_to_string(COALESCE(f.aliases, '{}'), ' ')), '[^a-z]+') AS w
    FROM public.foods f WHERE f.owner_id IS NULL OR f.owner_id = auth.uid()
  ) t WHERE length(w) >= 3;
$$;
GRANT EXECUTE ON FUNCTION public.food_vocabulary() TO authenticated, service_role;

-- The same food name can come from several sources (IFCT, USDA, BLS...): unique per name and source.
DROP INDEX IF EXISTS public.foods_global_name_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS foods_global_name_source_uidx ON public.foods (lower(name), COALESCE(source_ref, source)) WHERE owner_id IS NULL;
