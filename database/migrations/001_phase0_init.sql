-- FitOS Phase 0 schema
-- Apply in Supabase SQL editor or via CLI. Requires auth.users.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility_level') THEN
    CREATE TYPE public.visibility_level AS ENUM ('private', 'friends', 'public');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric', 'imperial')),
  default_visibility public.visibility_level NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  visibility public.visibility_level NOT NULL DEFAULT 'private',
  total_volume_kg NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts (id) ON DELETE CASCADE,
  exercise_id UUID,
  exercise_name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS public.workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id UUID NOT NULL REFERENCES public.workout_exercises (id) ON DELETE CASCADE,
  set_index INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  weight_kg NUMERIC(8, 3) NOT NULL DEFAULT 0,
  rpe NUMERIC(3, 1),
  is_warmup BOOLEAN NOT NULL DEFAULT FALSE,
  completed BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  sport TEXT NOT NULL CHECK (sport IN ('run', 'ride', 'walk', 'hike', 'other')),
  source TEXT NOT NULL CHECK (
    source IN ('native_gps', 'apple_health', 'health_connect', 'gpx', 'fit')
  ),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_s INTEGER NOT NULL DEFAULT 0,
  distance_m NUMERIC(12, 2) NOT NULL DEFAULT 0,
  elevation_gain_m NUMERIC(10, 2) NOT NULL DEFAULT 0,
  avg_pace_s_per_km NUMERIC(10, 2),
  polyline JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility public.visibility_level NOT NULL DEFAULT 'private',
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  activity_id UUID REFERENCES public.activities (id) ON DELETE SET NULL,
  workout_id UUID REFERENCES public.workouts (id) ON DELETE SET NULL,
  caption TEXT,
  visibility public.visibility_level NOT NULL DEFAULT 'friends',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activity_posts_subject CHECK (activity_id IS NOT NULL OR workout_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.activity_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.activity_posts (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'kudos' CHECK (kind IN ('kudos')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS public.food_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  image_storage_path TEXT,
  prediction JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  prediction_id UUID NOT NULL REFERENCES public.food_predictions (id) ON DELETE CASCADE,
  corrected_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workouts_user_started_idx ON public.workouts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS activities_user_started_idx ON public.activities (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS food_predictions_user_idx ON public.food_predictions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_posts_created_idx ON public.activity_posts (created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_corrections ENABLE ROW LEVEL SECURITY;

-- Owner + public (authenticated) read. Writes always scoped to auth.uid().

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY workouts_select ON public.workouts
  FOR SELECT USING (
    auth.uid() = user_id
    OR (visibility = 'public' AND auth.uid() IS NOT NULL)
  );

CREATE POLICY workouts_insert ON public.workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY workouts_update ON public.workouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY workouts_delete ON public.workouts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY workout_exercises_all ON public.workout_exercises
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workouts w
      WHERE w.id = workout_id AND w.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workouts w
      WHERE w.id = workout_id AND w.user_id = auth.uid()
    )
  );

CREATE POLICY workout_sets_all ON public.workout_sets
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.workout_exercises we
      JOIN public.workouts w ON w.id = we.workout_id
      WHERE we.id = workout_exercise_id AND w.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_exercises we
      JOIN public.workouts w ON w.id = we.workout_id
      WHERE we.id = workout_exercise_id AND w.user_id = auth.uid()
    )
  );

CREATE POLICY activities_select ON public.activities
  FOR SELECT USING (
    auth.uid() = user_id
    OR (visibility = 'public' AND auth.uid() IS NOT NULL)
  );

CREATE POLICY activities_insert ON public.activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY activities_update ON public.activities
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY activities_delete ON public.activities
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY activity_posts_select ON public.activity_posts
  FOR SELECT USING (
    auth.uid() = user_id
    OR (visibility = 'public' AND auth.uid() IS NOT NULL)
  );

CREATE POLICY activity_posts_insert ON public.activity_posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_posts_update ON public.activity_posts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_posts_delete ON public.activity_posts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY activity_reactions_select ON public.activity_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.activity_posts p
      WHERE p.id = post_id
        AND (p.user_id = auth.uid() OR (p.visibility = 'public' AND auth.uid() IS NOT NULL))
    )
  );

CREATE POLICY activity_reactions_insert ON public.activity_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_reactions_delete ON public.activity_reactions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY food_predictions_select ON public.food_predictions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY food_predictions_insert ON public.food_predictions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY food_predictions_delete ON public.food_predictions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY user_corrections_select ON public.user_corrections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_corrections_insert ON public.user_corrections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_corrections_delete ON public.user_corrections
  FOR DELETE USING (auth.uid() = user_id);
