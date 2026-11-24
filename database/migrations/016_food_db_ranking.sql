-- Food DB follow-ups after the first real import of fitos_food_db/.
-- 1. recompute_dish leaves food DB recipe dishes alone: their per-100 g values are lab-derived for the cooked dish,
--    and their dish_ingredients hold raw grams (cooking water isn't an ingredient), so summing them would be wrong.
-- 2. Legacy global rows (013 staples, the old IFCT-only import) that the food DB replaces get superseded_by and drop
--    out of search. They aren't deleted, so existing meal logs keep their food.
-- 3. match_foods: score was clamped to 1.0 before ordering, so exact-name ties ignored the tier bonus
--    ("idli" could return the 140 kcal/100 g staple above dish-idli). Order on the unclamped score.

CREATE OR REPLACE FUNCTION private.recompute_dish(p_dish UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM public.foods WHERE id = p_dish AND tier = 'recipe_calculated' AND external_id IS NOT NULL) THEN RETURN; END IF;
  SELECT COALESCE(sum(di.grams_per_serving), 0) INTO v_total FROM public.dish_ingredients di WHERE di.dish_food_id = p_dish;
  IF v_total <= 0 THEN RETURN; END IF;
  INSERT INTO public.food_nutrition (food_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, sat_fat_g, source, confidence)
  SELECT
    p_dish,
    round(sum(COALESCE(n.calories, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.protein_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.carbs_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.fat_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.fiber_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.sugar_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.sodium_mg, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    round(sum(COALESCE(n.sat_fat_g, 0) * di.grams_per_serving / 100) / v_total * 100, 2),
    'dish_sum',
    0.7
  FROM public.dish_ingredients di
  LEFT JOIN public.food_nutrition n ON n.food_id = di.ingredient_food_id
  WHERE di.dish_food_id = p_dish
  ON CONFLICT (food_id) DO UPDATE SET
    calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
    fiber_g = EXCLUDED.fiber_g, sugar_g = EXCLUDED.sugar_g, sodium_mg = EXCLUDED.sodium_mg, sat_fat_g = EXCLUDED.sat_fat_g,
    source = 'dish_sum', retrieved_at = now();
  UPDATE public.foods SET serving_grams = v_total, updated_at = now() WHERE id = p_dish;
END;
$$;

-- ---------- superseded legacy rows ----------

ALTER TABLE public.foods ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.foods (id) ON DELETE SET NULL;

-- A legacy global row is superseded by a food DB row with the same name, or whose aliases include its name.
-- Recipe dishes win over lab rows; an exact name match wins over an alias match. Called by scripts/import_food_db.ts.
CREATE OR REPLACE FUNCTION public.supersede_legacy_foods()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH pairs AS (
    SELECT DISTINCT ON (o.id) o.id AS old_id, d.id AS new_id
    FROM public.foods o
    JOIN public.foods d ON d.owner_id IS NULL AND d.external_id IS NOT NULL AND d.tier IN ('recipe_calculated', 'lab_verified')
      AND (lower(d.name) = lower(o.name) OR lower(o.name) IN (SELECT lower(a) FROM unnest(d.aliases) a))
    WHERE o.owner_id IS NULL AND o.external_id IS NULL AND o.superseded_by IS NULL
    ORDER BY o.id, CASE d.tier WHEN 'recipe_calculated' THEN 0 ELSE 1 END, (lower(d.name) = lower(o.name)) DESC
  )
  UPDATE public.foods f SET superseded_by = p.new_id FROM pairs p WHERE f.id = p.old_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.supersede_legacy_foods() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_legacy_foods() TO service_role;

-- ---------- match_foods ----------
-- Same as 014, plus: superseded rows are hidden, and rows are ordered on the unclamped score (tier bonus included)
-- with tier rank as the next tiebreak. The returned score is still clamped to 0..1 for the thresholds.
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
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', sv.unit, 'grams', sv.grams, 'label', sv.label) ORDER BY sv.food_id NULLS LAST, sv.grams), '[]'::jsonb)
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
