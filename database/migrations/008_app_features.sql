-- FitOS app features: profile goals, routines on workouts, PR baselines, meal provenance,
-- progress photos, recovery check-ins, food-scan rate limits, saved posts, social RPCs,
-- and the global exercise catalog.
-- Apply after 007_rls_hardening.sql.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS goal TEXT CHECK (goal IS NULL OR goal IN ('build_muscle', 'lose_fat', 'strength', 'endurance', 'general')),
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5, 1),
  ADD COLUMN IF NOT EXISTS calorie_target INTEGER NOT NULL DEFAULT 2200 CHECK (calorie_target BETWEEN 800 AND 8000),
  ADD COLUMN IF NOT EXISTS protein_target_g INTEGER NOT NULL DEFAULT 160 CHECK (protein_target_g BETWEEN 0 AND 600),
  ADD COLUMN IF NOT EXISTS carbs_target_g INTEGER NOT NULL DEFAULT 250 CHECK (carbs_target_g BETWEEN 0 AND 1500),
  ADD COLUMN IF NOT EXISTS fat_target_g INTEGER NOT NULL DEFAULT 70 CHECK (fat_target_g BETWEEN 0 AND 600),
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_format') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$') NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_post_type_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_post_type_check CHECK (post_type IN ('workout', 'activity', 'achievement', 'challenge', 'text', 'photo'));

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS routine_id UUID REFERENCES public.routines (id) ON DELETE SET NULL;

ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT FALSE;

-- AGENTS.md: food records carry source, source_version and confidence.
ALTER TABLE public.meal_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_version TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES public.food_predictions (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (split_part(storage_path, '/', 1) = user_id::text)
);

CREATE TABLE IF NOT EXISTS public.recovery_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  sleep_hours NUMERIC(4, 2) CHECK (sleep_hours IS NULL OR sleep_hours BETWEEN 0 AND 24),
  sleep_quality INTEGER CHECK (sleep_quality IS NULL OR sleep_quality BETWEEN 0 AND 100),
  stress INTEGER CHECK (stress IS NULL OR stress BETWEEN 0 AND 100),
  soreness INTEGER CHECK (soreness IS NULL OR soreness BETWEEN 0 AND 100),
  resting_hr INTEGER CHECK (resting_hr IS NULL OR resting_hr BETWEEN 25 AND 220),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.food_scan_usage (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  scans INTEGER NOT NULL DEFAULT 0 CHECK (scans >= 0),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.post_saves (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

ALTER TABLE public.progress_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_scan_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY progress_photos_owner ON public.progress_photos
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY recovery_checkins_owner ON public.recovery_checkins
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Written only by the food-scan edge function through consume_food_scan().
CREATE POLICY food_scan_usage_read_own ON public.food_scan_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY post_saves_select ON public.post_saves
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY post_saves_insert ON public.post_saves
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_saves.post_id));
CREATE POLICY post_saves_delete ON public.post_saves
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Indexes for the app's queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS workout_exercises_workout_idx ON public.workout_exercises (workout_id, order_index);
CREATE INDEX IF NOT EXISTS workout_exercises_name_idx ON public.workout_exercises (exercise_name);
CREATE INDEX IF NOT EXISTS workout_sets_exercise_idx ON public.workout_sets (workout_exercise_id, set_index);
CREATE INDEX IF NOT EXISTS meal_items_meal_idx ON public.meal_items (meal_id);
CREATE INDEX IF NOT EXISTS posts_workout_idx ON public.posts (workout_id) WHERE workout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_activity_idx ON public.posts (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_media_idx ON public.posts (media_path) WHERE media_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_reactions_post_idx ON public.post_reactions (post_id, kind);
CREATE INDEX IF NOT EXISTS personal_records_workout_idx ON public.personal_records (workout_id);
CREATE INDEX IF NOT EXISTS progress_photos_user_idx ON public.progress_photos (user_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS conversation_members_conversation_idx ON public.conversation_members (conversation_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_global_uidx ON public.products (barcode) WHERE user_id IS NULL AND barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exercises_global_name_uidx ON public.exercises (lower(name)) WHERE is_global;

-- ---------------------------------------------------------------------------
-- Streaks: count active days (a finished workout or an activity) in the user's
-- timezone. One rest day between active days keeps the streak alive.
-- Other people's private workouts and activities are not counted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_streak(p_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today DATE;
  v_prev DATE;
  v_day DATE;
  v_count INTEGER := 0;
  v_self BOOLEAN := p_user = auth.uid();
BEGIN
  IF auth.uid() IS NULL OR (NOT v_self AND private.is_blocked_between(auth.uid(), p_user)) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(NULLIF(timezone, ''), 'UTC') INTO v_tz FROM public.profiles WHERE id = p_user;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_prev := v_today + 1;
  FOR v_day IN
    SELECT DISTINCT d FROM (
      SELECT (w.started_at AT TIME ZONE v_tz)::date AS d
      FROM public.workouts w
      WHERE w.user_id = p_user AND w.completed_at IS NOT NULL AND (v_self OR w.visibility <> 'private')
        AND w.started_at > now() - INTERVAL '400 days'
      UNION
      SELECT (a.started_at AT TIME ZONE v_tz)::date
      FROM public.activities a
      WHERE a.user_id = p_user AND (v_self OR a.visibility <> 'private')
        AND a.started_at > now() - INTERVAL '400 days'
    ) days
    ORDER BY d DESC
  LOOP
    EXIT WHEN v_prev - v_day > 2;
    v_count := v_count + 1;
    v_prev := v_day;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Follow graph
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.follow_user(p_target UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_target = auth.uid() THEN RAISE EXCEPTION 'cannot_follow_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target AND onboarded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF private.is_blocked_between(auth.uid(), p_target) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  v_status := CASE WHEN private.is_private_profile(p_target) THEN 'pending' ELSE 'accepted' END;
  INSERT INTO public.follows (follower_id, following_id, status)
  VALUES (auth.uid(), p_target, v_status)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  SELECT status INTO v_status FROM public.follows WHERE follower_id = auth.uid() AND following_id = p_target;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_follow_request(p_follower UUID, p_accept BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_accept THEN
    UPDATE public.follows SET status = 'accepted', updated_at = now()
    WHERE follower_id = p_follower AND following_id = auth.uid() AND status = 'pending';
  ELSE
    DELETE FROM public.follows WHERE follower_id = p_follower AND following_id = auth.uid();
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Feed. SECURITY INVOKER: every row passes the caller's RLS on posts, workouts,
-- activities, reactions and comments.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_feed(
  p_author UUID DEFAULT NULL,
  p_post UUID DEFAULT NULL,
  p_saved BOOLEAN DEFAULT FALSE,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  post_type TEXT,
  body TEXT,
  media_path TEXT,
  workout_id UUID,
  workout_title TEXT,
  workout_volume_kg NUMERIC,
  workout_started_at TIMESTAMPTZ,
  workout_completed_at TIMESTAMPTZ,
  workout_exercise_count BIGINT,
  activity_id UUID,
  activity_sport TEXT,
  activity_distance_m NUMERIC,
  activity_duration_s INTEGER,
  visibility public.visibility_level,
  created_at TIMESTAMPTZ,
  like_count BIGINT,
  comment_count BIGINT,
  liked_by_me BOOLEAN,
  saved_by_me BOOLEAN
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    p.id, p.user_id, pr.username, pr.display_name, pr.avatar_url, p.post_type, p.body, p.media_path,
    p.workout_id, w.title, w.total_volume_kg, w.started_at, w.completed_at,
    (SELECT count(*) FROM public.workout_exercises we WHERE we.workout_id = w.id),
    p.activity_id, a.sport, a.distance_m, a.duration_s,
    p.visibility, p.created_at,
    (SELECT count(*) FROM public.post_reactions r WHERE r.post_id = p.id AND r.kind = 'like'),
    (SELECT count(*) FROM public.comments c WHERE c.post_id = p.id),
    EXISTS (SELECT 1 FROM public.post_reactions r WHERE r.post_id = p.id AND r.user_id = auth.uid() AND r.kind = 'like'),
    EXISTS (SELECT 1 FROM public.post_saves s WHERE s.post_id = p.id AND s.user_id = auth.uid())
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN public.workouts w ON w.id = p.workout_id
  LEFT JOIN public.activities a ON a.id = p.activity_id
  WHERE p.deleted_at IS NULL
    AND (p_before IS NULL OR p.created_at < p_before)
    AND (
      (p_post IS NOT NULL AND p.id = p_post)
      OR (p_post IS NULL AND p_saved AND EXISTS (SELECT 1 FROM public.post_saves s WHERE s.post_id = p.id AND s.user_id = auth.uid()))
      OR (p_post IS NULL AND NOT p_saved AND p_author IS NOT NULL AND p.user_id = p_author)
      OR (
        p_post IS NULL AND NOT p_saved AND p_author IS NULL
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = auth.uid() AND f.following_id = p.user_id AND f.status = 'accepted'
          )
        )
        AND NOT EXISTS (SELECT 1 FROM public.mutes m WHERE m.muter_id = auth.uid() AND m.muted_id = p.user_id)
      )
    )
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Profile card with counts. SECURITY DEFINER so counts include rows the viewer
-- cannot read one by one, but stats are hidden for private profiles you do not
-- follow, and nothing is returned across a block.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_profile_card(p_user UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_private BOOLEAN,
  followers BIGINT,
  following BIGINT,
  workouts BIGINT,
  follow_status TEXT,
  follows_me BOOLEAN,
  blocked_by_me BOOLEAN,
  can_view BOOLEAN,
  streak INTEGER,
  volume_30d NUMERIC,
  workouts_30d BIGINT,
  prs_30d BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_self BOOLEAN := p_user = auth.uid();
  v_view BOOLEAN;
  v_blocked_by_me BOOLEAN;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.blocks b WHERE b.blocker_id = v_me AND b.blocked_id = p_user) INTO v_blocked_by_me;
  IF NOT v_self AND NOT v_blocked_by_me AND private.is_blocked_between(v_me, p_user) THEN RETURN; END IF;
  v_view := v_self OR (NOT v_blocked_by_me AND (NOT private.is_private_profile(p_user) OR private.follows_accepted(v_me, p_user)));

  RETURN QUERY
  SELECT
    pr.id, pr.username, pr.display_name, pr.avatar_url, pr.bio, pr.is_private,
    (SELECT count(*) FROM public.follows f WHERE f.following_id = pr.id AND f.status = 'accepted'),
    (SELECT count(*) FROM public.follows f WHERE f.follower_id = pr.id AND f.status = 'accepted'),
    CASE WHEN v_view THEN (
      SELECT count(*) FROM public.workouts w
      WHERE w.user_id = pr.id AND w.completed_at IS NOT NULL AND (v_self OR w.visibility <> 'private')
    ) ELSE NULL END,
    (SELECT f.status FROM public.follows f WHERE f.follower_id = v_me AND f.following_id = pr.id),
    EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = pr.id AND f.following_id = v_me AND f.status = 'accepted'),
    v_blocked_by_me,
    v_view,
    CASE WHEN v_view THEN public.get_streak(pr.id) ELSE NULL END,
    CASE WHEN v_view THEN (
      SELECT COALESCE(sum(w.total_volume_kg), 0) FROM public.workouts w
      WHERE w.user_id = pr.id AND w.completed_at IS NOT NULL AND w.started_at > now() - INTERVAL '30 days'
        AND (v_self OR w.visibility <> 'private')
    ) ELSE NULL END,
    CASE WHEN v_view THEN (
      SELECT count(*) FROM public.workouts w
      WHERE w.user_id = pr.id AND w.completed_at IS NOT NULL AND w.started_at > now() - INTERVAL '30 days'
        AND (v_self OR w.visibility <> 'private')
    ) ELSE NULL END,
    CASE WHEN v_view THEN (
      SELECT count(*) FROM public.personal_records r
      LEFT JOIN public.workouts w ON w.id = r.workout_id
      WHERE r.user_id = pr.id AND NOT r.is_baseline AND r.achieved_at > now() - INTERVAL '30 days'
        AND (v_self OR (w.id IS NOT NULL AND w.visibility <> 'private'))
    ) ELSE NULL END
  FROM public.profiles pr
  WHERE pr.id = p_user;
END;
$$;

-- ---------------------------------------------------------------------------
-- Weekly leaderboard: you plus the people you follow. Totals only, and only from
-- workouts they shared beyond "only me".
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.weekly_leaderboard()
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  volume_kg NUMERIC,
  workouts BIGINT,
  streak INTEGER,
  is_me BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_tz TEXT;
  v_week_start TIMESTAMPTZ;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT COALESCE(NULLIF(pr.timezone, ''), 'UTC') INTO v_tz FROM public.profiles pr WHERE pr.id = v_me;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN v_tz := 'UTC'; END IF;
  v_week_start := date_trunc('week', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH members AS (
    SELECT v_me AS uid
    UNION
    SELECT f.following_id FROM public.follows f
    WHERE f.follower_id = v_me AND f.status = 'accepted' AND NOT private.is_blocked_between(v_me, f.following_id)
  )
  SELECT
    pr.id, pr.username, pr.display_name, pr.avatar_url,
    COALESCE(sum(w.total_volume_kg), 0)::NUMERIC,
    count(w.id),
    public.get_streak(pr.id),
    pr.id = v_me
  FROM members m
  JOIN public.profiles pr ON pr.id = m.uid
  LEFT JOIN public.workouts w
    ON w.user_id = pr.id AND w.completed_at IS NOT NULL AND w.started_at >= v_week_start
    AND (pr.id = v_me OR w.visibility <> 'private')
  GROUP BY pr.id
  ORDER BY 5 DESC, 6 DESC, pr.display_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- Notifications: likes and comments on your posts, follows and follow requests.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_notifications()
RETURNS TABLE (
  kind TEXT,
  actor_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  post_id UUID,
  body TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT n.kind, n.actor_id, pr.username, pr.display_name, pr.avatar_url, n.post_id, n.body, n.created_at
  FROM (
    SELECT 'like'::TEXT AS kind, r.user_id AS actor_id, r.post_id, NULL::TEXT AS body, r.created_at
    FROM public.post_reactions r JOIN public.posts p ON p.id = r.post_id
    WHERE p.user_id = auth.uid() AND r.user_id <> auth.uid() AND r.created_at > now() - INTERVAL '30 days'
    UNION ALL
    SELECT 'comment', c.user_id, c.post_id, left(c.body, 200), c.created_at
    FROM public.comments c JOIN public.posts p ON p.id = c.post_id
    WHERE p.user_id = auth.uid() AND c.user_id <> auth.uid() AND c.created_at > now() - INTERVAL '30 days'
    UNION ALL
    SELECT CASE WHEN f.status = 'pending' THEN 'follow_request' ELSE 'follow' END, f.follower_id, NULL, NULL, f.created_at
    FROM public.follows f
    WHERE f.following_id = auth.uid() AND (f.status = 'pending' OR f.created_at > now() - INTERVAL '30 days')
  ) n
  JOIN public.profiles pr ON pr.id = n.actor_id
  WHERE auth.uid() IS NOT NULL AND NOT private.is_blocked_between(auth.uid(), n.actor_id)
  ORDER BY n.created_at DESC
  LIMIT 50;
$$;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_other UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_other = v_me THEN RAISE EXCEPTION 'cannot_message_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_other AND onboarded_at IS NOT NULL)
     OR private.is_blocked_between(v_me, p_other) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF private.is_private_profile(p_other)
     AND NOT private.follows_accepted(v_me, p_other)
     AND NOT private.follows_accepted(p_other, v_me) THEN
    RAISE EXCEPTION 'follow_required';
  END IF;

  SELECT c.id INTO v_id
  FROM public.conversations c
  JOIN public.conversation_members a ON a.conversation_id = c.id AND a.user_id = v_me
  JOIN public.conversation_members b ON b.conversation_id = c.id AND b.user_id = p_other
  WHERE c.kind = 'direct'
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.conversations (kind) VALUES ('direct') RETURNING id INTO v_id;
  INSERT INTO public.conversation_members (conversation_id, user_id, last_read_at)
  VALUES (v_id, v_me, now()), (v_id, p_other, NULL);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_conversations()
RETURNS TABLE (
  conversation_id UUID,
  other_user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  last_body TEXT,
  last_at TIMESTAMPTZ,
  last_sender_id UUID,
  unread BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    me.conversation_id,
    other.user_id,
    pr.username,
    pr.display_name,
    pr.avatar_url,
    last_msg.body,
    last_msg.created_at,
    last_msg.sender_id,
    (
      SELECT count(*) FROM public.messages m
      WHERE m.conversation_id = me.conversation_id AND m.sender_id <> auth.uid() AND m.deleted_at IS NULL
        AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
    )
  FROM public.conversation_members me
  JOIN public.conversation_members other ON other.conversation_id = me.conversation_id AND other.user_id <> me.user_id
  JOIN public.profiles pr ON pr.id = other.user_id
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at, m.sender_id FROM public.messages m
    WHERE m.conversation_id = me.conversation_id AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1
  ) last_msg ON TRUE
  WHERE me.user_id = auth.uid() AND NOT private.is_blocked_between(auth.uid(), other.user_id)
  ORDER BY COALESCE(last_msg.created_at, me.created_at) DESC
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.conversation_members
  SET last_read_at = now(), updated_at = now()
  WHERE conversation_id = p_conversation AND user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Food-scan rate limit, called only by the food-scan edge function (service role).
-- Returns scans left today, or -1 when the limit is reached.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_food_scan(p_user UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scans INTEGER;
BEGIN
  INSERT INTO public.food_scan_usage AS u (user_id, day, scans)
  VALUES (p_user, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET scans = u.scans + 1 WHERE u.scans < p_limit
  RETURNING u.scans INTO v_scans;
  IF v_scans IS NULL THEN RETURN -1; END IF;
  RETURN p_limit - v_scans;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_food_scan(p_user UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.food_scan_usage SET scans = GREATEST(scans - 1, 0)
  WHERE user_id = p_user AND day = (now() AT TIME ZONE 'UTC')::date;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: signed-in users only; rate-limit functions for the service role only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_streak(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.follow_user(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_follow_request(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_feed(UUID, UUID, BOOLEAN, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_profile_card(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.weekly_leaderboard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_notifications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_conversations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_food_scan(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_food_scan(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_streak(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_follow_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_feed(UUID, UUID, BOOLEAN, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_card(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_food_scan(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_food_scan(UUID) TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- Global exercise catalog
-- ---------------------------------------------------------------------------

INSERT INTO public.exercises (name, muscle_group, equipment, is_global)
SELECT v.name, v.muscle_group, v.equipment, TRUE
FROM (VALUES
  ('Bench Press', 'chest', 'barbell'),
  ('Incline Bench Press', 'chest', 'barbell'),
  ('Dumbbell Bench Press', 'chest', 'dumbbell'),
  ('Incline Dumbbell Press', 'chest', 'dumbbell'),
  ('Chest Fly', 'chest', 'dumbbell'),
  ('Cable Crossover', 'chest', 'cable'),
  ('Machine Chest Press', 'chest', 'machine'),
  ('Push-up', 'chest', 'bodyweight'),
  ('Dip', 'chest', 'bodyweight'),
  ('Deadlift', 'back', 'barbell'),
  ('Barbell Row', 'back', 'barbell'),
  ('Dumbbell Row', 'back', 'dumbbell'),
  ('Pull-up', 'back', 'bodyweight'),
  ('Chin-up', 'back', 'bodyweight'),
  ('Lat Pulldown', 'back', 'cable'),
  ('Seated Cable Row', 'back', 'cable'),
  ('T-Bar Row', 'back', 'machine'),
  ('Face Pull', 'shoulders', 'cable'),
  ('Overhead Press', 'shoulders', 'barbell'),
  ('Dumbbell Shoulder Press', 'shoulders', 'dumbbell'),
  ('Arnold Press', 'shoulders', 'dumbbell'),
  ('Lateral Raise', 'shoulders', 'dumbbell'),
  ('Cable Lateral Raise', 'shoulders', 'cable'),
  ('Rear Delt Fly', 'shoulders', 'dumbbell'),
  ('Barbell Curl', 'biceps', 'barbell'),
  ('Dumbbell Curl', 'biceps', 'dumbbell'),
  ('Hammer Curl', 'biceps', 'dumbbell'),
  ('Preacher Curl', 'biceps', 'machine'),
  ('Cable Curl', 'biceps', 'cable'),
  ('Triceps Pushdown', 'triceps', 'cable'),
  ('Overhead Triceps Extension', 'triceps', 'dumbbell'),
  ('Skull Crusher', 'triceps', 'barbell'),
  ('Close-Grip Bench Press', 'triceps', 'barbell'),
  ('Back Squat', 'legs', 'barbell'),
  ('Front Squat', 'legs', 'barbell'),
  ('Goblet Squat', 'legs', 'dumbbell'),
  ('Leg Press', 'legs', 'machine'),
  ('Bulgarian Split Squat', 'legs', 'dumbbell'),
  ('Walking Lunge', 'legs', 'dumbbell'),
  ('Leg Extension', 'legs', 'machine'),
  ('Leg Curl', 'legs', 'machine'),
  ('Romanian Deadlift', 'legs', 'barbell'),
  ('Standing Calf Raise', 'legs', 'machine'),
  ('Hip Thrust', 'glutes', 'barbell'),
  ('Glute Bridge', 'glutes', 'bodyweight'),
  ('Cable Kickback', 'glutes', 'cable'),
  ('Plank', 'core', 'bodyweight'),
  ('Hanging Leg Raise', 'core', 'bodyweight'),
  ('Cable Crunch', 'core', 'cable'),
  ('Ab Wheel Rollout', 'core', 'other'),
  ('Russian Twist', 'core', 'bodyweight'),
  ('Kettlebell Swing', 'full body', 'kettlebell'),
  ('Clean and Press', 'full body', 'barbell'),
  ('Farmer''s Carry', 'full body', 'dumbbell'),
  ('Burpee', 'full body', 'bodyweight'),
  ('Rowing Machine', 'cardio', 'machine'),
  ('Assault Bike', 'cardio', 'machine'),
  ('Jump Rope', 'cardio', 'other')
) AS v (name, muscle_group, equipment)
WHERE NOT EXISTS (SELECT 1 FROM public.exercises e WHERE e.is_global AND lower(e.name) = lower(v.name));
