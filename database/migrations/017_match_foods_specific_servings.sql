-- match_foods servings now say whether each serving belongs to the food itself ("specific") or is a generic unit.
-- Serving.specific was read by the pipeline (gramsFor) and the web portion form (defaultPortion) but never sent, so
-- search defaulted idli to "1 serving (100 g)" = 97 kcal instead of "1 piece (40 g)" = 39 kcal.
-- Otherwise identical to 016.
CREATE OR REPLACE FUNCTION public.match_foods(
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
      AND f.superseded_by IS NULL
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
  ),
  scored AS (
    SELECT b.*,
      (b.base
        + CASE b.tier WHEN 'user' THEN 0.08 WHEN 'recipe_calculated' THEN 0.05 WHEN 'lab_verified' THEN 0.04 WHEN 'ai_estimate' THEN -0.03 ELSE 0 END
        + CASE WHEN b.recent THEN 0.02 ELSE 0 END)::float8 AS raw_score,
      (b.rrf + CASE b.tier WHEN 'user' THEN 0.010 WHEN 'recipe_calculated' THEN 0.007 WHEN 'lab_verified' THEN 0.005 ELSE 0 END)::float8 AS rrf_boosted,
      CASE b.tier WHEN 'user' THEN 0 WHEN 'recipe_calculated' THEN 1 WHEN 'lab_verified' THEN 2 WHEN 'community' THEN 3 ELSE 4 END AS tier_rank
    FROM boosted b
  )
  SELECT s.id, s.name, s.cuisine, s.source, s.verified, s.is_dish, s.own,
    n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g, s.serving_grams,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', sv.unit, 'grams', sv.grams, 'label', sv.label, 'specific', sv.food_id IS NOT NULL) ORDER BY sv.food_id NULLS LAST, sv.grams), '[]'::jsonb)
     FROM public.food_servings sv
     WHERE sv.food_id = s.id OR (sv.food_id IS NULL AND (sv.applies_to IS NULL OR s.search_text LIKE '%' || sv.applies_to || '%'))),
    LEAST(1.0, s.raw_score)::float8,
    s.rrf_boosted,
    s.tier, s.energy_check, s.source_ref, s.external_id
  FROM scored s
  LEFT JOIN public.food_nutrition n ON n.food_id = s.id
  ORDER BY s.raw_score DESC, s.tier_rank, s.rrf_boosted DESC
  LIMIT LEAST(GREATEST(COALESCE(k, 15), 1), 50);
$$;
GRANT EXECUTE ON FUNCTION public.match_foods(TEXT, extensions.vector, UUID, INTEGER, TEXT) TO authenticated, service_role;
