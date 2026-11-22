-- FitOS Phase 1 core schema
-- Extends the initial Phase 0 tables for nutrition, products, health, and recommendations.

CREATE TABLE IF NOT EXISTS public.exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  instructions TEXT,
  is_global BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility public.visibility_level NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES public.routines (id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES public.exercises (id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 3,
  reps INTEGER NOT NULL DEFAULT 8,
  target_weight_kg NUMERIC(8, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  serving_grams NUMERIC(8, 2),
  source TEXT NOT NULL DEFAULT 'user',
  source_version TEXT,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.food_nutrition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  calories NUMERIC(8, 2) NOT NULL DEFAULT 0,
  protein_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fiber_g NUMERIC(8, 2) DEFAULT 0,
  sugar_g NUMERIC(8, 2) DEFAULT 0,
  sodium_mg NUMERIC(8, 2) DEFAULT 0,
  source TEXT NOT NULL,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS public.meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  meal_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES public.meals (id) ON DELETE CASCADE,
  food_id UUID REFERENCES public.foods (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount_grams NUMERIC(8, 2) NOT NULL DEFAULT 0,
  calories NUMERIC(8, 2) NOT NULL DEFAULT 0,
  protein_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  brand TEXT,
  product_name TEXT,
  variant TEXT,
  barcode TEXT,
  product_type TEXT,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('exact', 'probable', 'multiple_matches', 'unknown', 'user_created')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_nutrition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  serving_size_g NUMERIC(8, 2),
  calories NUMERIC(8, 2) NOT NULL DEFAULT 0,
  protein_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(8, 2) NOT NULL DEFAULT 0,
  sugar_g NUMERIC(8, 2) DEFAULT 0,
  fiber_g NUMERIC(8, 2) DEFAULT 0,
  sodium_mg NUMERIC(8, 2) DEFAULT 0,
  source TEXT NOT NULL,
  source_url TEXT,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.body_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  weight_kg NUMERIC(6, 2),
  body_fat_pct NUMERIC(4, 2),
  waist_cm NUMERIC(6, 2),
  chest_cm NUMERIC(6, 2),
  arms_cm NUMERIC(6, 2),
  legs_cm NUMERIC(6, 2),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS public.health_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  active_calories INTEGER NOT NULL DEFAULT 0,
  sleep_hours NUMERIC(4, 2) NOT NULL DEFAULT 0,
  resting_hr INTEGER,
  training_load NUMERIC(8, 2) DEFAULT 0,
  readiness_score INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  original_prediction TEXT,
  user_correction TEXT,
  model_version TEXT,
  source TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exercises_user ON public.exercises (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON public.routine_exercises (routine_id, order_index);
CREATE INDEX IF NOT EXISTS idx_foods_user ON public.foods (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meals_user_date ON public.meals (user_id, meal_date DESC);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date ON public.body_measurements (user_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_daily_user_day ON public.health_daily (user_id, day DESC);
