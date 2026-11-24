-- Macro accuracy engine, adaptive targets and coach insights.
-- Deterministic maths lives here and in pipeline.ts; the AI only identifies foods and portions.

-- ---------- reference tables ----------

-- Cooked weight / raw weight. 2.8 means 100 g raw rice becomes 280 g boiled.
CREATE TABLE IF NOT EXISTS public.yield_factors (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category TEXT NOT NULL,
  method TEXT NOT NULL,
  ratio NUMERIC(5, 3) NOT NULL CHECK (ratio > 0),
  note TEXT,
  UNIQUE (category, method)
);

-- Share of the cooked dish weight that is absorbed oil, by cooking method.
CREATE TABLE IF NOT EXISTS public.fat_absorption (
  method TEXT PRIMARY KEY,
  pct NUMERIC(5, 2) NOT NULL CHECK (pct >= 0 AND pct <= 40),
  note TEXT
);

-- How a dish is usually cooked and what it is made of, by name.
CREATE TABLE IF NOT EXISTS public.dish_methods (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_pattern TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  category TEXT
);

-- g per ml for liquids, so cup, glass and ladle volumes become grams.
CREATE TABLE IF NOT EXISTS public.food_densities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_pattern TEXT NOT NULL UNIQUE,
  g_per_ml NUMERIC(4, 3) NOT NULL CHECK (g_per_ml > 0)
);

INSERT INTO public.yield_factors (category, method, ratio, note) VALUES
  ('rice', 'boiled', 2.8, 'raw rice to boiled rice 2.5-3.0'),
  ('millet', 'boiled', 2.6, 'ragi, jowar, quinoa'),
  ('pulse', 'cooked', 2.5, 'dal, rajma, chana'),
  ('pasta', 'boiled', 2.3, 'dry pasta to cooked'),
  ('oats', 'cooked', 4.0, 'porridge with water or milk'),
  ('flour', 'roti', 1.18, 'dry flour to roti: dough 1.6x, roti is 0.85 of dough... flour weight x1.18 per roti'),
  ('dough', 'roti', 0.85, 'dough to cooked roti'),
  ('meat', 'grilled', 0.75, 'chicken, mutton, fish grilled'),
  ('meat', 'curry', 0.8, 'meat cooked in gravy'),
  ('meat', 'fried', 0.7, 'pan or deep fried'),
  ('vegetable', 'cooked', 0.85, 'sabzi, stir fry'),
  ('egg', 'boiled', 1.0, 'no change'),
  ('potato', 'boiled', 1.0, 'no change'),
  ('potato', 'fried', 0.6, 'chips and fries')
ON CONFLICT (category, method) DO NOTHING;

INSERT INTO public.fat_absorption (method, pct, note) VALUES
  ('deep_fried', 12, 'puri, pakora, vada, samosa, fries'),
  ('shallow_fried', 7, 'paratha, cutlet, omelette'),
  ('tawa', 4, 'dosa, uttapam, chilla'),
  ('tadka', 3, 'dal, sambar, sabzi tempering'),
  ('roasted', 2, 'roasted vegetables, tikka'),
  ('none', 0, 'boiled, steamed, raw')
ON CONFLICT (method) DO NOTHING;

INSERT INTO public.dish_methods (name_pattern, method, category) VALUES
  ('puri|poori|bhatura', 'deep_fried', 'flour'),
  ('pakora|pakoda|bhaji|bajji', 'deep_fried', 'vegetable'),
  ('vada|vadai|medu', 'deep_fried', 'pulse'),
  ('samosa|kachori', 'deep_fried', 'flour'),
  ('fries|chips', 'deep_fried', 'potato'),
  ('paratha|parotta', 'shallow_fried', 'flour'),
  ('omelette|omelet|cutlet|tikki', 'shallow_fried', null),
  ('dosa|uttapam|chilla|cheela', 'tawa', null),
  ('dal|sambar|rasam|sabzi|sabji|curry|rajma|chana|chole', 'tadka', 'pulse'),
  ('tikka|tandoori|roast', 'roasted', 'meat'),
  ('idli|steamed|boiled|salad', 'none', null)
ON CONFLICT (name_pattern) DO NOTHING;

INSERT INTO public.food_densities (name_pattern, g_per_ml) VALUES
  ('milk|chai|tea|coffee|latte|flat white|cappuccino', 1.03),
  ('curd|yogurt|yoghurt|dahi|raita|lassi', 1.05),
  ('buttermilk|chaas', 1.02),
  ('sambar|rasam|dal|soup', 1.03),
  ('juice|soda|coke|cola|soft drink', 1.04),
  ('shake|smoothie', 1.08),
  ('water', 1.0),
  ('oil|ghee', 0.92)
ON CONFLICT (name_pattern) DO NOTHING;

-- Units: min, typical and max grams. New units: glass, scoop, tsp.
ALTER TABLE public.portion_ranges DROP CONSTRAINT IF EXISTS portion_ranges_unit_check;
ALTER TABLE public.portion_ranges ADD CONSTRAINT portion_ranges_unit_check
  CHECK (unit IN ('roti', 'katori', 'ladle', 'piece', 'plate', 'cup', 'glass', 'scoop', 'tbsp', 'tsp', 'serving'));
ALTER TABLE public.portion_ranges ADD COLUMN IF NOT EXISTS typical_g NUMERIC(7, 1);
UPDATE public.portion_ranges SET typical_g = round((min_g + max_g) / 2.0, 1) WHERE typical_g IS NULL;
INSERT INTO public.portion_ranges (unit, name_pattern, min_g, max_g, typical_g, note) VALUES
  ('glass', null, 200, 300, 250, 'one glass'),
  ('scoop', null, 25, 40, 31, 'one protein-powder scoop'),
  ('tsp', null, 3, 7, 5, 'one teaspoon'),
  ('piece', 'phulka', 20, 35, 28, 'one phulka'),
  ('glass', 'milk|lassi|buttermilk|chaas|juice|shake', 200, 300, 250, 'one glass of a drink')
ON CONFLICT (unit, name_pattern) DO NOTHING;
UPDATE public.portion_ranges SET typical_g = 40 WHERE unit = 'roti' AND name_pattern IS NULL;
UPDATE public.portion_ranges SET typical_g = 150 WHERE unit = 'katori' AND name_pattern IS NULL;
UPDATE public.portion_ranges SET typical_g = 100 WHERE unit = 'piece' AND name_pattern = 'dosa';
UPDATE public.portion_ranges SET typical_g = 40 WHERE unit = 'piece' AND name_pattern = 'idli';
UPDATE public.portion_ranges SET typical_g = 15 WHERE unit = 'tbsp' AND name_pattern IS NULL;

ALTER TABLE public.food_servings DROP CONSTRAINT IF EXISTS food_servings_unit_check;

-- ---------- micronutrients and full-precision snapshots ----------

ALTER TABLE public.food_nutrition
  ADD COLUMN IF NOT EXISTS iron_mg NUMERIC(8, 3),
  ADD COLUMN IF NOT EXISTS calcium_mg NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS vitamin_c_mg NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS b12_ug NUMERIC(8, 3),
  ADD COLUMN IF NOT EXISTS potassium_mg NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS alcohol_g NUMERIC(8, 2) DEFAULT 0;

ALTER TABLE public.meal_items
  ALTER COLUMN amount_grams TYPE NUMERIC(12, 4),
  ALTER COLUMN calories TYPE NUMERIC(12, 4),
  ALTER COLUMN protein_g TYPE NUMERIC(12, 4),
  ALTER COLUMN carbs_g TYPE NUMERIC(12, 4),
  ALTER COLUMN fat_g TYPE NUMERIC(12, 4),
  ALTER COLUMN fibre_g TYPE NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS micros JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS oil_level TEXT CHECK (oil_level IN ('none', 'light', 'normal', 'heavy')),
  ADD COLUMN IF NOT EXISTS cooking_method TEXT;

-- One deterministic calculation: per-100 g values x grams / 100, plus absorbed oil for the method.
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
    'sugar_g', coalesce(n.sugar_g, 0) * f.k,
    'micros', jsonb_strip_nulls(jsonb_build_object(
      'iron_mg', n.iron_mg * f.k, 'calcium_mg', n.calcium_mg * f.k, 'vitamin_c_mg', n.vitamin_c_mg * f.k,
      'b12_ug', n.b12_ug * f.k, 'sodium_mg', n.sodium_mg * f.k, 'potassium_mg', n.potassium_mg * f.k))
  )
  FROM f LEFT JOIN n ON true;
$$;
GRANT EXECUTE ON FUNCTION public.compute_item(UUID, NUMERIC, TEXT) TO authenticated;

-- Per-user dish profile learned from corrections: portion and oil level become the user's default.
CREATE TABLE IF NOT EXISTS public.user_dish_prefs (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  grams_per_unit NUMERIC(8, 2),
  oil_level TEXT CHECK (oil_level IN ('none', 'light', 'normal', 'heavy')),
  corrections INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_id)
);

-- ---------- targets ----------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('female', 'male', 'other')),
  ADD COLUMN IF NOT EXISTS birth_year INT CHECK (birth_year BETWEEN 1900 AND 2100),
  ADD COLUMN IF NOT EXISTS activity_level TEXT NOT NULL DEFAULT 'moderate' CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  ADD COLUMN IF NOT EXISTS nudges_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tdee_estimate INT,
  ADD COLUMN IF NOT EXISTS targets_updated_at TIMESTAMPTZ;

-- Weekly reviews, nudges, target changes and check-ins, shown on Home and in Coach.
CREATE TABLE IF NOT EXISTS public.coach_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('weekly_review', 'nudge', 'target_change', 'check_in')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coach_insights_user_idx ON public.coach_insights (user_id, created_at DESC);

ALTER TABLE public.yield_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fat_absorption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_densities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dish_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yield_factors_read ON public.yield_factors;
CREATE POLICY yield_factors_read ON public.yield_factors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fat_absorption_read ON public.fat_absorption;
CREATE POLICY fat_absorption_read ON public.fat_absorption FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS dish_methods_read ON public.dish_methods;
CREATE POLICY dish_methods_read ON public.dish_methods FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS food_densities_read ON public.food_densities;
CREATE POLICY food_densities_read ON public.food_densities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS user_dish_prefs_own ON public.user_dish_prefs;
CREATE POLICY user_dish_prefs_own ON public.user_dish_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS coach_insights_read ON public.coach_insights;
CREATE POLICY coach_insights_read ON public.coach_insights FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS coach_insights_mark_read ON public.coach_insights;
CREATE POLICY coach_insights_mark_read ON public.coach_insights FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.yield_factors, public.fat_absorption, public.dish_methods, public.food_densities, public.user_dish_prefs, public.coach_insights FROM anon;
GRANT SELECT ON public.yield_factors, public.fat_absorption, public.dish_methods, public.food_densities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_dish_prefs TO authenticated;
GRANT SELECT, UPDATE ON public.coach_insights TO authenticated;

-- Coach memories: users can view and delete them in Settings.
DROP POLICY IF EXISTS coach_memory_delete_own ON public.coach_memory;
CREATE POLICY coach_memory_delete_own ON public.coach_memory FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT DELETE ON public.coach_memory TO authenticated;

-- ---------- target maths ----------

-- Mifflin-St Jeor BMR. Missing sex uses the midpoint of the two formulas.
CREATE OR REPLACE FUNCTION private.bmr(p_weight NUMERIC, p_height NUMERIC, p_age INT, p_sex TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT 10 * p_weight + 6.25 * coalesce(p_height, 170) - 5 * coalesce(p_age, 30)
    + CASE p_sex WHEN 'male' THEN 5 WHEN 'female' THEN -161 ELSE -78 END;
$$;

CREATE OR REPLACE FUNCTION private.calorie_floor(p_bmr NUMERIC, p_sex TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(round(p_bmr), CASE p_sex WHEN 'male' THEN 1500 ELSE 1200 END)::int;
$$;

-- Weekly: estimate real TDEE from intake and weight trend; nudge targets by at most 150 kcal.
CREATE OR REPLACE FUNCTION private.adapt_targets()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  r RECORD;
  v_days INT; v_intake NUMERIC; v_weighins INT; v_slope NUMERIC; v_weight NUMERIC; v_tdee NUMERIC;
  v_goal_kcal NUMERIC; v_new INT; v_floor INT; v_bmr NUMERIC; v_changed INT := 0; v_reason TEXT;
BEGIN
  FOR r IN SELECT * FROM public.profiles WHERE onboarded_at IS NOT NULL LOOP
    SELECT count(*), avg(kcal) INTO v_days, v_intake FROM public.nutrition_daily
      WHERE user_id = r.id AND log_date >= current_date - 21 AND kcal > 0;
    SELECT count(*), regr_slope(weight_kg, extract(epoch FROM measured_at) / 86400.0), avg(weight_kg)
      INTO v_weighins, v_slope, v_weight
      FROM public.body_measurements WHERE user_id = r.id AND weight_kg IS NOT NULL AND measured_at >= now() - interval '21 days';
    CONTINUE WHEN v_days < 10 OR v_weighins < 4 OR v_weight IS NULL;
    v_tdee := v_intake - coalesce(v_slope, 0) * 7700;  -- kg/day x 7700 kcal/kg
    v_goal_kcal := v_tdee * CASE r.goal WHEN 'lose_fat' THEN 0.82 WHEN 'build_muscle' THEN 1.07 ELSE 1 END;
    v_bmr := private.bmr(v_weight, r.height_cm, extract(year FROM now())::int - r.birth_year, r.sex);
    v_floor := private.calorie_floor(v_bmr, r.sex);
    -- Never plan loss faster than 1% of bodyweight a week.
    v_goal_kcal := greatest(v_goal_kcal, v_tdee - (v_weight * 0.01 * 7700 / 7));
    v_new := greatest(v_floor, r.calorie_target + least(150, greatest(-150, round(v_goal_kcal - r.calorie_target))))::int;
    UPDATE public.profiles SET tdee_estimate = round(v_tdee) WHERE id = r.id;
    CONTINUE WHEN abs(v_new - r.calorie_target) < 50;
    v_reason := format('Over %s logged days you averaged %s kcal and your weight moved %s kg/week, so your real maintenance is about %s kcal. Calorie target %s -> %s.',
      v_days, round(v_intake), round(coalesce(v_slope, 0) * 7, 2), round(v_tdee), r.calorie_target, v_new);
    UPDATE public.profiles
      SET calorie_target = v_new,
          carbs_target_g = greatest(50, round((v_new - protein_target_g * 4 - fat_target_g * 9) / 4.0))::int,
          targets_updated_at = now()
      WHERE id = r.id;
    INSERT INTO public.coach_insights (user_id, kind, title, body, data)
      VALUES (r.id, 'target_change', 'Targets updated', v_reason, jsonb_build_object('from', r.calorie_target, 'to', v_new, 'tdee', round(v_tdee)));
    v_changed := v_changed + 1;
  END LOOP;
  RETURN v_changed;
END;
$$;

-- Sunday: averages vs targets, adherence, protein, weight, training; one win and one focus. Under 120 words.
CREATE OR REPLACE FUNCTION private.weekly_review(p_user UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  r RECORD; v RECORD; v_w RECORD; v_t RECORD; v_body TEXT; v_win TEXT; v_focus TEXT; v_n INT := 0;
BEGIN
  FOR r IN SELECT * FROM public.profiles WHERE onboarded_at IS NOT NULL AND (p_user IS NULL OR id = p_user) LOOP
    SELECT count(*) AS days, round(avg(kcal)) AS kcal, round(avg(protein_g)) AS protein,
           count(*) FILTER (WHERE abs(kcal - r.calorie_target) <= r.calorie_target * 0.1) AS on_target,
           count(*) FILTER (WHERE protein_g >= r.protein_target_g * 0.9) AS protein_days
      INTO v FROM public.nutrition_daily WHERE user_id = r.id AND log_date > current_date - 7 AND kcal > 0;
    CONTINUE WHEN v.days = 0;
    SELECT round((max(weight_kg) FILTER (WHERE measured_at > now() - interval '3 days') - max(weight_kg) FILTER (WHERE measured_at <= now() - interval '6 days'))::numeric, 1) AS change
      INTO v_w FROM public.body_measurements WHERE user_id = r.id AND measured_at > now() - interval '10 days';
    SELECT count(*) AS sessions, round(coalesce(sum(total_volume_kg), 0)) AS volume
      INTO v_t FROM public.workouts WHERE user_id = r.id AND completed_at > now() - interval '7 days';
    v_win := CASE
      WHEN v.protein_days >= 5 THEN format('Protein hit on %s of %s days.', v.protein_days, v.days)
      WHEN v_t.sessions >= 3 THEN format('%s training sessions, %s kg lifted.', v_t.sessions, v_t.volume)
      WHEN v.days >= 6 THEN 'You logged almost every day.'
      ELSE format('You logged %s days.', v.days) END;
    v_focus := CASE
      WHEN v.days < 5 THEN 'Log at least 5 days next week so the numbers mean something.'
      WHEN v.protein_days < 4 THEN format('Get to %s g protein on 5 days: add one high-protein item at lunch.', r.protein_target_g)
      WHEN v.on_target < 4 THEN format('Keep calories within 10%% of %s on 5 days.', r.calorie_target)
      ELSE 'Keep the routine; add one more training session if you can.' END;
    v_body := format('Average %s kcal (target %s) and %s g protein (target %s). On target %s%% of days. %s%s training sessions. Win: %s Focus: %s',
      v.kcal, r.calorie_target, v.protein, r.protein_target_g, round(100.0 * v.on_target / v.days),
      CASE WHEN v_w.change IS NULL THEN '' ELSE format('Weight %s%s kg. ', CASE WHEN v_w.change > 0 THEN '+' ELSE '' END, v_w.change) END,
      v_t.sessions, v_win, v_focus);
    INSERT INTO public.coach_insights (user_id, kind, title, body, data)
      VALUES (r.id, 'weekly_review', 'Your week', v_body,
        jsonb_build_object('days', v.days, 'avg_kcal', v.kcal, 'avg_protein', v.protein, 'adherence_pct', round(100.0 * v.on_target / v.days), 'protein_days', v.protein_days, 'weight_change', v_w.change, 'sessions', v_t.sessions, 'volume', v_t.volume));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Hourly: at 7 pm local, at most one nudge a day. Very low intake for days gets a gentle check-in instead.
CREATE OR REPLACE FUNCTION private.daily_nudges()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE r RECORD; v_today RECORD; v_low INT; v_foods TEXT; v_left INT; v_n INT := 0; v_local DATE;
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
    CONTINUE WHEN v_left < 30;
    SELECT string_agg(name, ' or ') INTO v_foods FROM (
      SELECT mi.name FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id
      WHERE m.user_id = r.id AND mi.amount_grams > 0 AND mi.protein_g / mi.amount_grams > 0.1
      GROUP BY mi.name ORDER BY count(*) DESC LIMIT 2) t;
    INSERT INTO public.coach_insights (user_id, kind, title, body, data)
      VALUES (r.id, 'nudge', 'Protein check', format('You''re %s g protein short today.%s', v_left,
        CASE WHEN v_foods IS NULL THEN ' Greek yogurt, paneer or eggs would cover it.' ELSE format(' %s would cover it.', v_foods) END),
        jsonb_build_object('protein_left', v_left));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Weekly: a dish that 3 or more users saved with similar values (within 15% kcal) becomes a global verified food.
CREATE OR REPLACE FUNCTION private.promote_dishes()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE r RECORD; v_id UUID; v_n INT := 0;
BEGIN
  FOR r IN
    SELECT lower(f.name) AS key, min(f.name) AS name, count(DISTINCT f.owner_id) AS owners,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY fn.calories) AS kcal,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY fn.protein_g) AS protein,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY fn.carbs_g) AS carbs,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY fn.fat_g) AS fat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY fn.fiber_g) AS fibre
    FROM public.foods f JOIN public.food_nutrition fn ON fn.food_id = f.id
    WHERE f.owner_id IS NOT NULL AND f.is_dish
    GROUP BY lower(f.name)
    HAVING count(DISTINCT f.owner_id) >= 3
  LOOP
    CONTINUE WHEN (SELECT count(DISTINCT f.owner_id) FROM public.foods f JOIN public.food_nutrition fn ON fn.food_id = f.id
                   WHERE lower(f.name) = r.key AND f.owner_id IS NOT NULL AND abs(fn.calories - r.kcal) <= r.kcal * 0.15) < 3;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.foods WHERE owner_id IS NULL AND verified AND lower(name) = r.key);
    INSERT INTO public.foods (name, owner_id, source, verified, is_dish, confidence)
      VALUES (r.name, NULL, 'verified', TRUE, TRUE, 0.9) RETURNING id INTO v_id;
    INSERT INTO public.food_nutrition (food_id, calories, protein_g, carbs_g, fat_g, fiber_g, source, confidence)
      VALUES (v_id, r.kcal, r.protein, r.carbs, r.fat, r.fibre, 'community', 0.9);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION private.adapt_targets(), private.weekly_review(UUID), private.daily_nudges(), private.promote_dishes() FROM PUBLIC, anon, authenticated;

-- Schedules (pg_cron must be enabled; skipped quietly when it isn't).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('fitos-adapt-targets', '0 3 * * 1', 'select private.adapt_targets()');
    PERFORM cron.schedule('fitos-weekly-review', '0 9 * * 0', 'select private.weekly_review()');
    PERFORM cron.schedule('fitos-daily-nudges', '0 * * * *', 'select private.daily_nudges()');
    PERFORM cron.schedule('fitos-promote-dishes', '30 3 * * 1', 'select private.promote_dishes()');
  END IF;
END $$;

-- Weekly review on demand for the signed-in user (coach tool and Home card).
CREATE OR REPLACE FUNCTION public.my_weekly_review()
RETURNS SETOF public.coach_insights LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coach_insights WHERE user_id = auth.uid() AND kind = 'weekly_review' AND created_at > now() - interval '1 day') THEN
    PERFORM private.weekly_review(auth.uid());
  END IF;
  RETURN QUERY SELECT * FROM public.coach_insights WHERE user_id = auth.uid() AND kind = 'weekly_review' ORDER BY created_at DESC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.my_weekly_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_weekly_review() TO authenticated;

-- Verified staples (cooked, as eaten, per 100 g; IFCT 2017 and USDA reference values) so suggestions and
-- retrieval have grounded numbers before the full IFCT import.
DO $$
DECLARE
  v RECORD; v_id UUID;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('Rice, cooked', 'indian', 130, 2.7, 28.2, 0.3, 0.4, 'katori', 150),
    ('Roti (whole wheat)', 'indian', 297, 9.8, 54.7, 3.9, 7.3, 'roti', 40),
    ('Toor dal, cooked', 'indian', 118, 6.8, 18.2, 2.0, 4.5, 'katori', 150),
    ('Moong dal, cooked', 'indian', 105, 7.0, 17.5, 1.0, 4.0, 'katori', 150),
    ('Rajma, cooked', 'indian', 127, 8.7, 22.8, 0.5, 6.4, 'katori', 150),
    ('Chana, cooked', 'indian', 164, 8.9, 27.4, 2.6, 7.6, 'katori', 150),
    ('Paneer', 'indian', 265, 18.3, 1.2, 20.8, 0, 'piece', 25),
    ('Curd (dahi)', 'indian', 60, 3.1, 4.4, 3.3, 0, 'katori', 150),
    ('Idli', 'south_indian', 140, 4.5, 29.0, 0.4, 1.2, 'piece', 40),
    ('Plain dosa', 'south_indian', 190, 4.0, 30.0, 6.0, 1.5, 'piece', 100),
    ('Sambar', 'south_indian', 75, 3.2, 10.5, 2.2, 2.4, 'katori', 150),
    ('Poha', 'indian', 160, 3.0, 27.0, 4.5, 1.5, 'plate', 200),
    ('Upma', 'indian', 170, 4.0, 25.0, 6.0, 1.8, 'plate', 200),
    ('Besan chilla', 'indian', 210, 10.0, 25.0, 8.0, 4.5, 'piece', 80),
    ('Soya chunks, cooked', 'indian', 115, 17.0, 10.0, 0.5, 4.0, 'katori', 100),
    ('Moong sprouts', 'indian', 30, 3.0, 6.0, 0.2, 1.8, 'katori', 100),
    ('Mixed vegetable sabzi', 'indian', 90, 2.5, 9.0, 5.0, 3.0, 'katori', 150),
    ('Chicken breast, grilled', 'western', 165, 31.0, 0, 3.6, 0, 'piece', 150),
    ('Chicken curry', 'indian', 160, 15.0, 4.0, 9.5, 0.8, 'katori', 150),
    ('Fish curry', 'indian', 130, 14.0, 4.0, 6.5, 0.5, 'katori', 150),
    ('Egg, boiled', 'western', 155, 12.6, 1.1, 10.6, 0, 'piece', 50),
    ('Greek yogurt, plain', 'western', 97, 9.0, 3.9, 5.0, 0, 'cup', 170),
    ('Milk, toned', 'indian', 58, 3.1, 4.7, 3.0, 0, 'cup', 250),
    ('Tofu, firm', 'western', 144, 15.8, 2.8, 8.7, 2.3, 'piece', 100),
    ('Oats, cooked with water', 'western', 71, 2.5, 12.0, 1.5, 1.7, 'cup', 240),
    ('Whey protein powder', 'western', 400, 78.0, 8.0, 6.0, 0, 'serving', 31),
    ('Banana', 'western', 89, 1.1, 22.8, 0.3, 2.6, 'piece', 118),
    ('Apple', 'western', 52, 0.3, 13.8, 0.2, 2.4, 'piece', 180),
    ('Peanut butter', 'western', 588, 25.1, 20.0, 50.0, 6.0, 'tbsp', 16),
    ('Almonds', 'western', 579, 21.2, 21.6, 49.9, 12.5, 'serving', 28),
    ('Whole wheat bread', 'western', 247, 13.0, 41.0, 3.4, 7.0, 'piece', 32),
    ('Potato, boiled', 'western', 87, 1.9, 20.1, 0.1, 1.8, 'piece', 150)
  ) AS t(name, cuisine, kcal, p, c, f, fibre, unit, grams) LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.foods WHERE owner_id IS NULL AND lower(name) = lower(v.name));
    INSERT INTO public.foods (name, owner_id, source, verified, is_dish, cuisine, confidence)
      VALUES (v.name, NULL, 'verified', TRUE, FALSE, v.cuisine, 0.95) RETURNING id INTO v_id;
    INSERT INTO public.food_nutrition (food_id, calories, protein_g, carbs_g, fat_g, fiber_g, source, confidence)
      VALUES (v_id, v.kcal, v.p, v.c, v.f, v.fibre, 'reference', 0.95);
    INSERT INTO public.food_servings (food_id, unit, grams, label) VALUES (v_id, v.unit, v.grams, '1 ' || v.unit);
  END LOOP;
END $$;
