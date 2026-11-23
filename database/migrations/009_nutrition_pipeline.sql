-- FitOS nutrition pipeline: Supabase as the single source of food data, one AI provider.
-- Extends existing tables (foods, food_nutrition, meals, meal_items, food_predictions -> food_analyses,
-- user_corrections, food_scan_usage -> ai_usage, coach_messages, profiles) and adds only what had no home.
-- Apply after 008_app_features.sql.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- foods: global (owner_id NULL) or a user's own
-- ---------------------------------------------------------------------------

ALTER TABLE public.foods RENAME COLUMN user_id TO owner_id;

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS cuisine TEXT,
  ADD COLUMN IF NOT EXISTS is_dish BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS search TSVECTOR,
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

UPDATE public.foods SET source = 'user' WHERE source NOT IN ('ifct', 'ai', 'user', 'barcode', 'verified');
ALTER TABLE public.foods ALTER COLUMN source SET DEFAULT 'user';
ALTER TABLE public.foods ADD CONSTRAINT foods_source_check CHECK (source IN ('ifct', 'ai', 'user', 'barcode', 'verified'));
ALTER TABLE public.foods ADD CONSTRAINT foods_cuisine_check
  CHECK (cuisine IS NULL OR cuisine IN ('indian', 'south_indian', 'north_indian', 'australian', 'western', 'other'));

CREATE OR REPLACE FUNCTION private.foods_search_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, extensions
AS $$
BEGIN
  NEW.name := trim(NEW.name);
  NEW.search_text := lower(NEW.name || ' ' || array_to_string(COALESCE(NEW.aliases, '{}'), ' '));
  NEW.search := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS foods_search_fields ON public.foods;
CREATE TRIGGER foods_search_fields
  BEFORE INSERT OR UPDATE OF name, aliases ON public.foods
  FOR EACH ROW EXECUTE FUNCTION private.foods_search_fields();

UPDATE public.foods SET name = name;

CREATE INDEX IF NOT EXISTS foods_search_trgm_idx ON public.foods USING gin (search_text extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS foods_search_fts_idx ON public.foods USING gin (search);
CREATE INDEX IF NOT EXISTS foods_owner_idx ON public.foods (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS foods_global_name_uidx ON public.foods (lower(name)) WHERE owner_id IS NULL;

-- ---------------------------------------------------------------------------
-- food_nutrition: one row per food, all values per 100 g
-- ---------------------------------------------------------------------------

ALTER TABLE public.food_nutrition
  ADD COLUMN IF NOT EXISTS sat_fat_g NUMERIC(8, 2) DEFAULT 0;
ALTER TABLE public.food_nutrition ALTER COLUMN source SET DEFAULT 'per_100g';
CREATE UNIQUE INDEX IF NOT EXISTS food_nutrition_food_uidx ON public.food_nutrition (food_id);
COMMENT ON TABLE public.food_nutrition IS 'Per 100 g: calories (kcal), protein_g, carbs_g, fat_g, fiber_g (fibre), sugar_g, sodium_mg, sat_fat_g.';

-- ---------------------------------------------------------------------------
-- Servings and dish recipes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.food_servings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID REFERENCES public.foods (id) ON DELETE CASCADE,
  unit TEXT NOT NULL CHECK (unit IN ('roti', 'katori', 'ladle', 'piece', 'plate', 'cup', 'tbsp', 'g', 'serving')),
  grams NUMERIC(8, 2) NOT NULL CHECK (grams > 0),
  label TEXT,
  -- Generic rows (food_id NULL) apply to every food, or only to foods whose name contains applies_to.
  applies_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_servings_food_idx ON public.food_servings (food_id);

CREATE TABLE IF NOT EXISTS public.dish_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_food_id UUID NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  ingredient_food_id UUID NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  grams_per_serving NUMERIC(8, 2) NOT NULL CHECK (grams_per_serving > 0),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (dish_food_id <> ingredient_food_id)
);
CREATE INDEX IF NOT EXISTS dish_ingredients_dish_idx ON public.dish_ingredients (dish_food_id, position);

-- Dish nutrition = sum of its ingredients, stored per 100 g of the cooked dish.
CREATE OR REPLACE FUNCTION private.recompute_dish(p_dish UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
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

CREATE OR REPLACE FUNCTION private.dish_ingredients_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM private.recompute_dish(OLD.dish_food_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.dish_food_id <> OLD.dish_food_id) THEN
    PERFORM private.recompute_dish(NEW.dish_food_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dish_ingredients_changed ON public.dish_ingredients;
CREATE TRIGGER dish_ingredients_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.dish_ingredients
  FOR EACH ROW EXECUTE FUNCTION private.dish_ingredients_changed();

-- ---------------------------------------------------------------------------
-- Meals and items: one meal per user, local date and meal type; items keep a macro snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE public.meals ADD COLUMN IF NOT EXISTS log_date DATE;
UPDATE public.meals m
SET log_date = (m.meal_date AT TIME ZONE COALESCE((SELECT p.timezone FROM public.profiles p WHERE p.id = m.user_id), 'UTC'))::date
WHERE m.log_date IS NULL;
ALTER TABLE public.meals ALTER COLUMN log_date SET DEFAULT (now() AT TIME ZONE 'UTC')::date;
ALTER TABLE public.meals ALTER COLUMN log_date SET NOT NULL;

ALTER TABLE public.meals DROP CONSTRAINT IF EXISTS meals_meal_type_check;
UPDATE public.meals SET meal_type = 'snacks' WHERE meal_type IN ('snack', 'other');
ALTER TABLE public.meals ADD CONSTRAINT meals_meal_type_check CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snacks'));

-- Merge any duplicates before enforcing one meal per slot.
UPDATE public.meal_items mi SET meal_id = keep.id
FROM public.meals dup
JOIN LATERAL (
  SELECT k.id FROM public.meals k
  WHERE k.user_id = dup.user_id AND k.log_date = dup.log_date AND k.meal_type = dup.meal_type
  ORDER BY k.created_at, k.id LIMIT 1
) keep ON TRUE
WHERE mi.meal_id = dup.id AND dup.id <> keep.id;
DELETE FROM public.meals dup
USING public.meals k
WHERE dup.user_id = k.user_id AND dup.log_date = k.log_date AND dup.meal_type = k.meal_type
  AND (dup.created_at, dup.id) > (k.created_at, k.id);
CREATE UNIQUE INDEX IF NOT EXISTS meals_user_day_type_uidx ON public.meals (user_id, log_date, meal_type);

ALTER TABLE public.meal_items RENAME COLUMN prediction_id TO analysis_id;
ALTER TABLE public.meal_items
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(8, 2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'g',
  ADD COLUMN IF NOT EXISTS fibre_g NUMERIC(8, 2) NOT NULL DEFAULT 0;
UPDATE public.meal_items SET source = CASE
  WHEN source IN ('search', 'text_ai', 'photo_ai', 'barcode', 'manual', 'chat') THEN source
  WHEN source = 'claude_vision' THEN 'photo_ai'
  WHEN source = 'open_food_facts' THEN 'barcode'
  WHEN source = 'usda_fdc' THEN 'search'
  ELSE 'manual' END;
ALTER TABLE public.meal_items ADD CONSTRAINT meal_items_source_check
  CHECK (source IN ('search', 'text_ai', 'photo_ai', 'barcode', 'manual', 'chat'));
COMMENT ON COLUMN public.meal_items.calories IS 'Snapshot at log time; later edits to the food do not change history.';

-- ---------------------------------------------------------------------------
-- food_predictions becomes food_analyses (text or photo); corrections point at it
-- ---------------------------------------------------------------------------

ALTER TABLE public.food_predictions RENAME TO food_analyses;
ALTER TABLE public.food_analyses RENAME COLUMN image_storage_path TO image_path;
ALTER TABLE public.food_analyses RENAME COLUMN prediction TO draft;
ALTER TABLE public.food_analyses
  ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'text' CHECK (input_type IN ('text', 'photo')),
  ADD COLUMN IF NOT EXISTS input_text TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS raw_json JSONB,
  ADD COLUMN IF NOT EXISTS detected_cuisine TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'edited', 'discarded')),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.food_analyses ALTER COLUMN draft SET DEFAULT '{}'::jsonb;
ALTER TABLE public.food_analyses ALTER COLUMN source SET DEFAULT 'nutrition-ai';
ALTER TABLE public.food_analyses ALTER COLUMN source_version SET DEFAULT '1';
ALTER TABLE public.food_analyses ALTER COLUMN confidence SET DEFAULT 0;
ALTER INDEX IF EXISTS food_predictions_user_idx RENAME TO food_analyses_user_idx;

CREATE POLICY food_analyses_update ON public.food_analyses
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.user_corrections RENAME COLUMN prediction_id TO analysis_id;
ALTER TABLE public.user_corrections
  ADD COLUMN IF NOT EXISTS food_id UUID REFERENCES public.foods (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS user_corrections_user_food_idx ON public.user_corrections (user_id, food_id);

-- ---------------------------------------------------------------------------
-- Daily totals, kept in sync by triggers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.nutrition_daily (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  kcal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  protein_g NUMERIC(10, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(10, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(10, 2) NOT NULL DEFAULT 0,
  fibre_g NUMERIC(10, 2) NOT NULL DEFAULT 0,
  per_meal JSONB NOT NULL DEFAULT '{}'::jsonb,
  items INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, log_date)
);

CREATE OR REPLACE FUNCTION private.sync_nutrition_daily(p_user UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items INTEGER;
BEGIN
  IF p_user IS NULL OR p_date IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_items
  FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id
  WHERE m.user_id = p_user AND m.log_date = p_date;
  IF v_items = 0 THEN
    DELETE FROM public.nutrition_daily WHERE user_id = p_user AND log_date = p_date;
    RETURN;
  END IF;
  INSERT INTO public.nutrition_daily (user_id, log_date, kcal, protein_g, carbs_g, fat_g, fibre_g, per_meal, items, updated_at)
  SELECT
    p_user, p_date,
    sum(t.kcal), sum(t.protein_g), sum(t.carbs_g), sum(t.fat_g), sum(t.fibre_g),
    jsonb_object_agg(t.meal_type, jsonb_build_object('kcal', t.kcal, 'protein_g', t.protein_g, 'carbs_g', t.carbs_g, 'fat_g', t.fat_g, 'fibre_g', t.fibre_g, 'items', t.items)),
    sum(t.items), now()
  FROM (
    SELECT m.meal_type,
      round(sum(mi.calories), 2) AS kcal, round(sum(mi.protein_g), 2) AS protein_g, round(sum(mi.carbs_g), 2) AS carbs_g,
      round(sum(mi.fat_g), 2) AS fat_g, round(sum(mi.fibre_g), 2) AS fibre_g, count(*)::int AS items
    FROM public.meal_items mi JOIN public.meals m ON m.id = mi.meal_id
    WHERE m.user_id = p_user AND m.log_date = p_date
    GROUP BY m.meal_type
  ) t
  ON CONFLICT (user_id, log_date) DO UPDATE SET
    kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
    fibre_g = EXCLUDED.fibre_g, per_meal = EXCLUDED.per_meal, items = EXCLUDED.items, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION private.meal_items_sync_daily()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT m.user_id, m.log_date FROM public.meals m
    WHERE m.id IN (
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.meal_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.meal_id END
    )
  LOOP
    PERFORM private.sync_nutrition_daily(r.user_id, r.log_date);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.meals_sync_daily()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM private.sync_nutrition_daily(OLD.user_id, OLD.log_date); END IF;
  IF TG_OP = 'UPDATE' THEN PERFORM private.sync_nutrition_daily(NEW.user_id, NEW.log_date); END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS meal_items_sync_daily ON public.meal_items;
CREATE TRIGGER meal_items_sync_daily
  AFTER INSERT OR UPDATE OR DELETE ON public.meal_items
  FOR EACH ROW EXECUTE FUNCTION private.meal_items_sync_daily();

DROP TRIGGER IF EXISTS meals_sync_daily ON public.meals;
CREATE TRIGGER meals_sync_daily
  AFTER UPDATE OF log_date, meal_type, user_id OR DELETE ON public.meals
  FOR EACH ROW EXECUTE FUNCTION private.meals_sync_daily();

-- ---------------------------------------------------------------------------
-- Goals: the targets already live on profiles (set during onboarding), exposed under the expected name.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.nutrition_goals WITH (security_invoker = true) AS
SELECT p.id AS user_id, p.calorie_target AS kcal, p.protein_target_g AS protein_g, p.carbs_target_g AS carbs_g, p.fat_target_g AS fat_g
FROM public.profiles p
WHERE p.id = auth.uid();

-- ---------------------------------------------------------------------------
-- Favourite meals ("my usual breakfast")
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.favourite_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  meal_type TEXT CHECK (meal_type IS NULL OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.favourite_meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  favourite_meal_id UUID NOT NULL REFERENCES public.favourite_meals (id) ON DELETE CASCADE,
  food_id UUID REFERENCES public.foods (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(8, 2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'g',
  grams NUMERIC(8, 2) NOT NULL DEFAULT 0,
  calories NUMERIC(8, 2) NOT NULL DEFAULT 0,
  protein_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fibre_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS favourite_meals_user_idx ON public.favourite_meals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS favourite_meal_items_meal_idx ON public.favourite_meal_items (favourite_meal_id, position);

-- ---------------------------------------------------------------------------
-- Coach messages (table from 006): free-standing chat, tool calls recorded
-- ---------------------------------------------------------------------------

ALTER TABLE public.coach_messages ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE public.coach_messages RENAME COLUMN body TO content;
ALTER TABLE public.coach_messages DROP CONSTRAINT IF EXISTS coach_messages_role_check;
ALTER TABLE public.coach_messages ADD CONSTRAINT coach_messages_role_check CHECK (role IN ('user', 'assistant', 'tool', 'coach'));
ALTER TABLE public.coach_messages ADD COLUMN IF NOT EXISTS tool_calls JSONB;
CREATE INDEX IF NOT EXISTS coach_messages_user_created_idx ON public.coach_messages (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- AI usage: the food-scan counter becomes a general per-user daily AI call counter (30/day)
-- ---------------------------------------------------------------------------

ALTER TABLE public.food_scan_usage RENAME TO ai_usage;
ALTER TABLE public.ai_usage RENAME COLUMN scans TO calls;
DROP FUNCTION IF EXISTS public.consume_food_scan(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.refund_food_scan(UUID);

CREATE OR REPLACE FUNCTION public.consume_ai_call(p_user UUID, p_limit INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_calls INTEGER;
BEGIN
  INSERT INTO public.ai_usage AS u (user_id, day, calls)
  VALUES (p_user, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET calls = u.calls + 1 WHERE u.calls < p_limit
  RETURNING u.calls INTO v_calls;
  IF v_calls IS NULL THEN RETURN -1; END IF;
  RETURN p_limit - v_calls;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_ai_call(p_user UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ai_usage SET calls = GREATEST(calls - 1, 0)
  WHERE user_id = p_user AND day = (now() AT TIME ZONE 'UTC')::date;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_call(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ai_call(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_call(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_ai_call(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.food_servings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favourite_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favourite_meal_items ENABLE ROW LEVEL SECURITY;

-- foods: read global + own; write only your own unverified foods ("my foods").
-- Global and AI foods are written by edge functions with the service role.
DROP POLICY IF EXISTS foods_select ON public.foods;
CREATE POLICY foods_select ON public.foods
  FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY foods_own_insert ON public.foods
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND source = 'user' AND verified = FALSE);
CREATE POLICY foods_own_update ON public.foods
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND source = 'user' AND verified = FALSE);
CREATE POLICY foods_own_delete ON public.foods
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS food_nutrition_select ON public.food_nutrition;
CREATE POLICY food_nutrition_select ON public.food_nutrition
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_nutrition.food_id));
CREATE POLICY food_nutrition_own_write ON public.food_nutrition
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_nutrition.food_id AND f.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_nutrition.food_id AND f.owner_id = auth.uid()));

CREATE POLICY food_servings_select ON public.food_servings
  FOR SELECT TO authenticated
  USING (food_id IS NULL OR EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_servings.food_id));
CREATE POLICY food_servings_own_write ON public.food_servings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_servings.food_id AND f.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_servings.food_id AND f.owner_id = auth.uid()));

CREATE POLICY dish_ingredients_select ON public.dish_ingredients
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = dish_ingredients.dish_food_id));
CREATE POLICY dish_ingredients_own_write ON public.dish_ingredients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = dish_ingredients.dish_food_id AND f.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = dish_ingredients.dish_food_id AND f.owner_id = auth.uid()));

CREATE POLICY nutrition_daily_select ON public.nutrition_daily
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY favourite_meals_owner ON public.favourite_meals
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY favourite_meal_items_owner ON public.favourite_meal_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.favourite_meals fm WHERE fm.id = favourite_meal_items.favourite_meal_id AND fm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.favourite_meals fm WHERE fm.id = favourite_meal_items.favourite_meal_id AND fm.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: meal photos, private, owner only, {user_id}/{uuid}.webp
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('food-photos', 'food-photos', FALSE, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS fitos_food_photos_owner ON storage.objects;
CREATE POLICY fitos_food_photos_owner ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'food-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'food-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Seed: common Indian and Australian portions (generic rows apply by food name)
-- ---------------------------------------------------------------------------

INSERT INTO public.food_servings (food_id, unit, grams, label, applies_to)
SELECT NULL, v.unit, v.grams, v.label, v.applies_to
FROM (VALUES
  ('roti', 40, '1 roti', NULL),
  ('piece', 40, '1 roti', 'roti'),
  ('piece', 40, '1 chapati', 'chapati'),
  ('piece', 80, '1 paratha', 'paratha'),
  ('piece', 30, '1 puri', 'puri'),
  ('piece', 90, '1 naan', 'naan'),
  ('piece', 40, '1 idli', 'idli'),
  ('piece', 100, '1 dosa', 'dosa'),
  ('piece', 60, '1 vada', 'vada'),
  ('piece', 120, '1 uttapam', 'uttapam'),
  ('piece', 70, '1 samosa', 'samosa'),
  ('piece', 50, '1 egg', 'egg'),
  ('piece', 35, '1 slice', 'bread'),
  ('piece', 35, '1 slice', 'toast'),
  ('piece', 120, '1 banana', 'banana'),
  ('katori', 150, '1 katori', NULL),
  ('ladle', 120, '1 ladle', NULL),
  ('cup', 160, '1 cup cooked rice', 'rice'),
  ('cup', 240, '1 cup', NULL),
  ('tbsp', 15, '1 tbsp', NULL),
  ('tbsp', 5, '1 tsp', 'vegemite'),
  ('plate', 350, '1 plate', NULL),
  ('plate', 300, '1 plate biryani', 'biryani'),
  ('serving', 100, '1 serving', NULL),
  ('g', 1, 'grams', NULL)
) AS v (unit, grams, label, applies_to)
WHERE NOT EXISTS (
  SELECT 1 FROM public.food_servings s
  WHERE s.food_id IS NULL AND s.unit = v.unit AND COALESCE(s.applies_to, '') = COALESCE(v.applies_to, '')
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
