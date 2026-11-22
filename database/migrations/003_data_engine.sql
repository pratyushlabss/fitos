-- FitOS data engine: recovery, analytics, jobs, audit, and consent.
-- Apply after 001_phase0_init.sql and 002_phase1_fitos_core.sql.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'workouts', 'activities', 'food_predictions', 'user_corrections',
    'exercises', 'routines', 'routine_exercises', 'foods', 'food_nutrition',
    'meals', 'meal_items', 'products', 'product_nutrition', 'body_measurements',
    'health_daily'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()',
      table_name
    );
  END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS public.training_load (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  load NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (load >= 0),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, source)
);

CREATE TABLE IF NOT EXISTS public.recovery_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, algorithm_version)
);

CREATE TABLE IF NOT EXISTS public.daily_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  components JSONB NOT NULL DEFAULT '{}'::jsonb,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, algorithm_version)
);

CREATE TABLE IF NOT EXISTS public.personal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES public.exercises (id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('max_weight', 'max_reps', 'estimated_1rm', 'volume')),
  value NUMERIC(12, 3) NOT NULL CHECK (value >= 0),
  workout_id UUID REFERENCES public.workouts (id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'fitos',
  source_version TEXT NOT NULL DEFAULT '1.0',
  achieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_code TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('health_data', 'food_image_processing', 'ai_processing', 'ml_training', 'social_sharing')),
  version TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_type, version)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  request_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_load_user_day_idx ON public.training_load (user_id, day DESC);
CREATE INDEX IF NOT EXISTS recovery_scores_user_day_idx ON public.recovery_scores (user_id, day DESC);
CREATE INDEX IF NOT EXISTS daily_scores_user_day_idx ON public.daily_scores (user_id, day DESC);
CREATE INDEX IF NOT EXISTS personal_records_user_exercise_idx ON public.personal_records (user_id, exercise_name, achieved_at DESC);
CREATE INDEX IF NOT EXISTS jobs_user_status_idx ON public.jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON public.audit_logs (user_id, created_at DESC);

ALTER TABLE public.training_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_load_owner ON public.training_load
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY recovery_scores_owner ON public.recovery_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_scores_owner ON public.daily_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY personal_records_owner ON public.personal_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY jobs_owner ON public.jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY consent_records_owner ON public.consent_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY audit_logs_owner ON public.audit_logs
  FOR SELECT USING (auth.uid() = user_id);
