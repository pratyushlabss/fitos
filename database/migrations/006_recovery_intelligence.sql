-- FitOS recovery intelligence: raw events, canonical metrics, daily snapshots.
-- Apply after 005_messaging.sql.
-- Missing values stay NULL. Never default recovery inputs to 0.

CREATE TABLE IF NOT EXISTS public.fitness_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL DEFAULT '1.0',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, source, event_type, occurred_at, payload_hash)
);

CREATE TABLE IF NOT EXISTS public.canonical_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC,
  unit TEXT NOT NULL,
  source TEXT,
  source_priority INTEGER,
  observed_at TIMESTAMPTZ,
  confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  availability TEXT NOT NULL CHECK (availability IN ('present', 'missing')),
  conflict_rejected JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, metric)
);

CREATE TABLE IF NOT EXISTS public.daily_data_status (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  nutrition_status TEXT NOT NULL DEFAULT 'missing',
  nutrition_events INTEGER NOT NULL DEFAULT 0,
  workout_status TEXT NOT NULL DEFAULT 'missing',
  workout_events INTEGER NOT NULL DEFAULT 0,
  activity_status TEXT NOT NULL DEFAULT 'missing',
  activity_source TEXT,
  sleep_status TEXT NOT NULL DEFAULT 'missing',
  stress_status TEXT NOT NULL DEFAULT 'missing',
  soreness_status TEXT NOT NULL DEFAULT 'missing',
  cardio_status TEXT NOT NULL DEFAULT 'missing',
  data_completeness INTEGER NOT NULL DEFAULT 0 CHECK (data_completeness BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
  event_ids UUID[] NOT NULL DEFAULT '{}',
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.daily_fitness_features (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.recovery_daily (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  recovery_score INTEGER CHECK (recovery_score IS NULL OR recovery_score BETWEEN 0 AND 100),
  readiness_score INTEGER CHECK (readiness_score IS NULL OR readiness_score BETWEEN 0 AND 100),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  components JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_inputs TEXT[] NOT NULL DEFAULT '{}',
  data_completeness INTEGER NOT NULL DEFAULT 0 CHECK (data_completeness BETWEEN 0 AND 100),
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
  algorithm TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, algorithm)
);

CREATE TABLE IF NOT EXISTS public.coach_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  recovery_algorithm TEXT NOT NULL,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coach_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  context_snapshot_id UUID REFERENCES public.coach_context_snapshots (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.coach_sessions (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('coach', 'user')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  recommendation TEXT NOT NULL,
  followed BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ml_feature_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fitness_events_user_occurred_idx
  ON public.fitness_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fitness_events_user_type_idx
  ON public.fitness_events (user_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS recovery_daily_user_day_idx
  ON public.recovery_daily (user_id, day DESC);
CREATE INDEX IF NOT EXISTS coach_context_user_day_idx
  ON public.coach_context_snapshots (user_id, day DESC, created_at DESC);

ALTER TABLE public.fitness_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_data_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_fitness_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_feature_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY fitness_events_owner ON public.fitness_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY canonical_daily_metrics_owner ON public.canonical_daily_metrics
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_data_status_owner ON public.daily_data_status
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_snapshots_owner ON public.daily_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_fitness_features_owner ON public.daily_fitness_features
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY recovery_daily_owner ON public.recovery_daily
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY coach_context_snapshots_owner ON public.coach_context_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY coach_sessions_owner ON public.coach_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY coach_messages_owner ON public.coach_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY recommendation_feedback_owner ON public.recommendation_feedback
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY ml_feature_snapshots_owner ON public.ml_feature_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
