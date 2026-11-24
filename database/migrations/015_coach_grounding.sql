-- Coach grounding: full nutrient calculation, grounding log, saved plans, richer weekly review and nudge.

-- compute_item now also returns saturated fat, and sugar inside micros (so meal_items.micros keeps it).
CREATE OR REPLACE FUNCTION public.compute_item(p_food_id UUID, p_grams NUMERIC, p_method TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH n AS (
    SELECT fn.* FROM public.food_nutrition fn WHERE fn.food_id = p_food_id ORDER BY fn.retrieved_at DESC LIMIT 1
  ), f AS (
    SELECT p_grams / 100.0 AS k, coalesce((SELECT pct FROM public.fat_absorption WHERE method = p_method), 0) / 100.0 * p_grams AS oil_g
  )
  SELECT jsonb_build_object(
    'grams', p_grams,
    'oil_g', f.oil_g,
    'kcal', coalesce(n.calories, 0) * f.k + f.oil_g * 8.84,
    'protein_g', coalesce(n.protein_g, 0) * f.k,
    'carbs_g', coalesce(n.carbs_g, 0) * f.k,
    'fat_g', coalesce(n.fat_g, 0) * f.k + f.oil_g,
    'fibre_g', coalesce(n.fiber_g, 0) * f.k,
    'sugar_g', n.sugar_g * f.k,
    'sat_fat_g', n.sat_fat_g * f.k,
    'micros', jsonb_strip_nulls(jsonb_build_object(
      'sugar_g', n.sugar_g * f.k, 'sat_fat_g', n.sat_fat_g * f.k,
      'iron_mg', n.iron_mg * f.k, 'calcium_mg', n.calcium_mg * f.k, 'vitamin_c_mg', n.vitamin_c_mg * f.k,
      'b12_ug', n.b12_ug * f.k, 'sodium_mg', n.sodium_mg * f.k, 'potassium_mg', n.potassium_mg * f.k))
  )
  FROM f LEFT JOIN n ON true;
$$;
GRANT EXECUTE ON FUNCTION public.compute_item(UUID, NUMERIC, TEXT) TO authenticated, service_role;

-- Replies where the model wrote numbers that no tool produced (regenerated or stripped).
CREATE TABLE IF NOT EXISTS public.coach_grounding_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  reply TEXT NOT NULL,
  untraced TEXT[] NOT NULL DEFAULT '{}',
  action TEXT NOT NULL CHECK (action IN ('regenerated', 'stripped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.coach_grounding_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_grounding_log_own ON public.coach_grounding_log;
CREATE POLICY coach_grounding_log_own ON public.coach_grounding_log FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.coach_grounding_log FROM anon;
GRANT SELECT, INSERT ON public.coach_grounding_log TO authenticated;

-- Plans from plan_day / plan_week / "Add to plan", loggable with one tap.
CREATE TABLE IF NOT EXISTS public.meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('day', 'week', 'custom')),
  title TEXT NOT NULL,
  days JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meal_plans_user_idx ON public.meal_plans (user_id, created_at DESC);
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meal_plans_own ON public.meal_plans;
CREATE POLICY meal_plans_own ON public.meal_plans FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.meal_plans FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plans TO authenticated;

-- Weekly review: adds fibre and sodium averages, best and worst meal by protein density, and one swap.
CREATE OR REPLACE FUNCTION private.weekly_review(p_user UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  r RECORD; v RECORD; v_w RECORD; v_t RECORD; v_m RECORD; v_best TEXT; v_worst TEXT; v_swap TEXT;
  v_body TEXT; v_win TEXT; v_focus TEXT; v_n INT := 0;
BEGIN
  FOR r IN SELECT * FROM public.profiles WHERE onboarded_at IS NOT NULL AND (p_user IS NULL OR id = p_user) LOOP
    SELECT count(*) AS days, round(avg(kcal)) AS kcal, round(avg(protein_g)) AS protein, round(avg(fibre_g)) AS fibre,
           count(*) FILTER (WHERE abs(kcal - r.calorie_target) <= r.calorie_target * 0.1) AS on_target,
           count(*) FILTER (WHERE protein_g >= r.protein_target_g * 0.9) AS protein_days
      INTO v FROM public.nutrition_daily WHERE user_id = r.id AND log_date > current_date - 7 AND kcal > 0;
    CONTINUE WHEN v.days = 0;
    SELECT round(sum((mi.micros->>'sodium_mg')::numeric) / greatest(count(DISTINCT m.log_date), 1)) AS sodium
      INTO v_m FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id
      WHERE m.user_id = r.id AND m.log_date > current_date - 7 AND mi.micros ? 'sodium_mg';
    -- Meals by protein per 100 kcal.
    SELECT string_agg(label, '') FILTER (WHERE rn_best = 1), string_agg(label, '') FILTER (WHERE rn_worst = 1) INTO v_best, v_worst FROM (
      SELECT format('%s %s (%s g protein per 100 kcal)', initcap(m.meal_type), to_char(m.log_date, 'Dy'), round(sum(mi.protein_g) * 100 / nullif(sum(mi.calories), 0), 1)) AS label,
             row_number() OVER (ORDER BY sum(mi.protein_g) / nullif(sum(mi.calories), 0) DESC) AS rn_best,
             row_number() OVER (ORDER BY sum(mi.protein_g) / nullif(sum(mi.calories), 0) ASC) AS rn_worst
      FROM public.meals m JOIN public.meal_items mi ON mi.meal_id = m.id
      WHERE m.user_id = r.id AND m.log_date > current_date - 7
      GROUP BY m.id, m.meal_type, m.log_date HAVING sum(mi.calories) > 150) t;
    -- One swap: the most-logged low-protein-density food and a same-category food with at least 50% more protein per kcal.
    SELECT format('try %s instead of %s', alt.name, mine.name) INTO v_swap
    FROM (
      SELECT f.id, f.name, f.category, f.cuisine, fn.protein_g / nullif(fn.calories, 0) AS density
      FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id JOIN public.foods f ON f.id = mi.food_id JOIN public.food_nutrition fn ON fn.food_id = f.id
      WHERE m.user_id = r.id AND m.log_date > current_date - 7 AND fn.calories > 50
      GROUP BY f.id, f.name, f.category, f.cuisine, fn.protein_g, fn.calories
      ORDER BY count(*) DESC, fn.protein_g / nullif(fn.calories, 0) ASC LIMIT 1
    ) mine
    JOIN LATERAL (
      SELECT f2.name FROM public.foods f2 JOIN public.food_nutrition fn2 ON fn2.food_id = f2.id
      WHERE f2.owner_id IS NULL AND f2.id <> mine.id AND f2.tier IN ('lab_verified', 'recipe_calculated')
        AND (f2.category = mine.category OR (mine.category IS NULL AND f2.cuisine = mine.cuisine))
        AND fn2.protein_g / nullif(fn2.calories, 0) >= coalesce(mine.density, 0) * 1.5
      ORDER BY fn2.protein_g / nullif(fn2.calories, 0) DESC LIMIT 1
    ) alt ON true;
    SELECT round((max(weight_kg) FILTER (WHERE measured_at > now() - interval '3 days') - max(weight_kg) FILTER (WHERE measured_at <= now() - interval '6 days'))::numeric, 1) AS change
      INTO v_w FROM public.body_measurements WHERE user_id = r.id AND measured_at > now() - interval '10 days';
    SELECT count(*) AS sessions, round(coalesce(sum(total_volume_kg), 0)) AS volume
      INTO v_t FROM public.workouts WHERE user_id = r.id AND completed_at > now() - interval '7 days';
    v_win := CASE
      WHEN v.protein_days >= 5 THEN format('protein hit on %s of %s days.', v.protein_days, v.days)
      WHEN v_t.sessions >= 3 THEN format('%s sessions, %s kg lifted.', v_t.sessions, v_t.volume)
      ELSE format('%s days logged.', v.days) END;
    v_focus := CASE
      WHEN v.days < 5 THEN 'log at least 5 days.'
      WHEN v.protein_days < 4 THEN format('reach %s g protein on 5 days.', r.protein_target_g)
      WHEN coalesce(v.fibre, 0) < 25 THEN 'get fibre to 25 g: add dal, sprouts or a fruit daily.'
      WHEN coalesce(v_m.sodium, 0) > 2000 THEN 'keep sodium under 2,000 mg: fewer pickles and packaged snacks.'
      WHEN v.on_target < 4 THEN format('stay within 10%% of %s kcal on 5 days.', r.calorie_target)
      ELSE 'keep it going.' END;
    v_body := format('Avg %s kcal (target %s), %s g protein (target %s), %s g fibre%s. On target %s%% of days.%s %s sessions. Best: %s. Lowest: %s.%s Win: %s Focus: %s',
      v.kcal, r.calorie_target, v.protein, r.protein_target_g, coalesce(v.fibre, 0),
      CASE WHEN v_m.sodium IS NULL THEN '' ELSE format(', %s mg sodium', v_m.sodium) END,
      round(100.0 * v.on_target / v.days),
      CASE WHEN v_w.change IS NULL THEN '' ELSE format(' Weight %s%s kg.', CASE WHEN v_w.change > 0 THEN '+' ELSE '' END, v_w.change) END,
      v_t.sessions, coalesce(v_best, '–'), coalesce(v_worst, '–'),
      CASE WHEN v_swap IS NULL THEN '' ELSE format(' Swap: %s.', v_swap) END,
      v_win, v_focus);
    INSERT INTO public.coach_insights (user_id, kind, title, body, data)
      VALUES (r.id, 'weekly_review', 'Your week', v_body,
        jsonb_build_object('days', v.days, 'avg_kcal', v.kcal, 'avg_protein', v.protein, 'avg_fibre', v.fibre, 'avg_sodium_mg', v_m.sodium,
          'adherence_pct', round(100.0 * v.on_target / v.days), 'protein_days', v.protein_days, 'weight_change', v_w.change,
          'sessions', v_t.sessions, 'volume', v_t.volume, 'best_meal', v_best, 'worst_meal', v_worst, 'swap', v_swap));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Evening nudge: names a food the user actually eats with the portion that closes the protein gap, from their own logged rows.
CREATE OR REPLACE FUNCTION private.daily_nudges()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE r RECORD; v_today RECORD; v_low INT; v_food RECORD; v_left INT; v_n INT := 0; v_local DATE; v_portions NUMERIC;
BEGIN
  FOR r IN SELECT * FROM public.profiles WHERE onboarded_at IS NOT NULL AND nudges_enabled LOOP
    CONTINUE WHEN extract(hour FROM now() AT TIME ZONE coalesce(r.timezone, 'UTC')) <> 19;
    v_local := (now() AT TIME ZONE coalesce(r.timezone, 'UTC'))::date;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.coach_insights WHERE user_id = r.id AND kind IN ('nudge', 'check_in') AND created_at > now() - interval '20 hours');
    SELECT count(*) INTO v_low FROM public.nutrition_daily WHERE user_id = r.id AND log_date BETWEEN v_local - 3 AND v_local - 1 AND kcal > 0 AND kcal < 800;
    IF v_low >= 3 THEN
      INSERT INTO public.coach_insights (user_id, kind, title, body)
        VALUES (r.id, 'check_in', 'Checking in',
          'Your logs show under 800 kcal for a few days. If that''s accurate, it''s less than your body needs. Is everything okay? If eating feels hard right now, a doctor or dietitian can help.');
      v_n := v_n + 1;
      CONTINUE;
    END IF;
    SELECT * INTO v_today FROM public.nutrition_daily WHERE user_id = r.id AND log_date = v_local;
    CONTINUE WHEN v_today IS NULL;
    v_left := r.protein_target_g - round(v_today.protein_g)::int;
    CONTINUE WHEN v_left < 20;
    -- The user's most frequent protein-dense food, with their usual portion's protein from their own logged rows.
    SELECT mi.name, round(avg(mi.amount_grams)) AS grams, avg(mi.protein_g) AS protein INTO v_food
    FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id
    WHERE m.user_id = r.id AND mi.amount_grams > 0 AND mi.calories > 0 AND mi.protein_g * 4 / mi.calories >= 0.25
    GROUP BY mi.name ORDER BY count(*) DESC LIMIT 1;
    IF v_food.name IS NULL THEN
      INSERT INTO public.coach_insights (user_id, kind, title, body, data)
        VALUES (r.id, 'nudge', 'Protein check', format('You''re %s g protein short today. Ask the coach for a dinner that closes it.', v_left), jsonb_build_object('protein_left', v_left));
    ELSE
      v_portions := greatest(1, least(3, round(v_left / greatest(v_food.protein, 1) * 2) / 2.0));
      INSERT INTO public.coach_insights (user_id, kind, title, body, data)
        VALUES (r.id, 'nudge', 'Protein check',
          format('You''re %s g protein short today. %s× your usual %s (%s g) adds about %s g.', v_left, v_portions, v_food.name, v_food.grams, round(v_food.protein * v_portions)),
          jsonb_build_object('protein_left', v_left, 'food', v_food.name, 'portions', v_portions));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION private.weekly_review(UUID), private.daily_nudges() FROM PUBLIC, anon, authenticated;
