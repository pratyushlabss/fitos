-- FitOS RLS hardening. The web app now talks to Supabase directly with the anon key,
-- so these policies are the security boundary.
-- Apply after 006_recovery_intelligence.sql.

-- Columns that the policies below depend on.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_path TEXT;

-- Helpers live outside the API-exposed schema so they cannot be called through PostgREST.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_blocked_between(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks bl
    WHERE (bl.blocker_id = a AND bl.blocked_id = b) OR (bl.blocker_id = b AND bl.blocked_id = a)
  );
$$;

CREATE OR REPLACE FUNCTION private.follows_accepted(p_follower UUID, p_following UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = p_follower AND f.following_id = p_following AND f.status = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_private_profile(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT pr.is_private FROM public.profiles pr WHERE pr.id = p_user), TRUE);
$$;

-- One rule for workouts, activities and posts:
-- owner always; never across a block; public content of a public profile for any signed-in user;
-- friends content (and public content of a private profile) for accepted followers.
CREATE OR REPLACE FUNCTION private.can_view_content(p_owner UUID, p_visibility public.visibility_level)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = p_owner
      OR (
        NOT private.is_blocked_between(auth.uid(), p_owner)
        AND (
          (p_visibility = 'public' AND NOT private.is_private_profile(p_owner))
          OR (p_visibility IN ('public', 'friends') AND private.follows_accepted(auth.uid(), p_owner))
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.is_conversation_member(p_conversation UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation AND cm.user_id = auth.uid()
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tables from 002 had no RLS at all.
-- ---------------------------------------------------------------------------

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_nutrition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_nutrition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Reference data: readable when signed in, written only by the service role (edge functions).
-- Exception: exercises also allow custom, user-owned rows, which AGENTS.md requires.
CREATE POLICY exercises_select ON public.exercises
  FOR SELECT TO authenticated
  USING (is_global OR user_id = auth.uid());
CREATE POLICY exercises_custom_insert ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_global = FALSE);
CREATE POLICY exercises_custom_update ON public.exercises
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_global = FALSE)
  WITH CHECK (user_id = auth.uid() AND is_global = FALSE);
CREATE POLICY exercises_custom_delete ON public.exercises
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND is_global = FALSE);

CREATE POLICY foods_select ON public.foods
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY food_nutrition_select ON public.food_nutrition
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_nutrition.food_id));
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY product_nutrition_select ON public.product_nutrition
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_nutrition.product_id));

-- User-owned data: full CRUD on your own rows only. Children are checked through the parent.
CREATE POLICY routines_owner ON public.routines
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY routine_exercises_owner ON public.routine_exercises
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.routines r WHERE r.id = routine_exercises.routine_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.routines r WHERE r.id = routine_exercises.routine_id AND r.user_id = auth.uid()));
CREATE POLICY meals_owner ON public.meals
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY meal_items_owner ON public.meal_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meals m WHERE m.id = meal_items.meal_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meals m WHERE m.id = meal_items.meal_id AND m.user_id = auth.uid()));
CREATE POLICY body_measurements_owner ON public.body_measurements
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY health_daily_owner ON public.health_daily
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_feedback_owner ON public.user_feedback
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Profiles: readable by signed-in users except across a block. Was owner-only,
--    which made every social screen empty.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR NOT private.is_blocked_between(auth.uid(), id));

-- ---------------------------------------------------------------------------
-- 3. Workouts and activities: visible by the shared rule, or through a visible post.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS workouts_select ON public.workouts;
CREATE POLICY workouts_select ON public.workouts
  FOR SELECT TO authenticated
  USING (
    private.can_view_content(user_id, visibility)
    OR EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.workout_id = workouts.id AND p.deleted_at IS NULL AND private.can_view_content(p.user_id, p.visibility)
    )
  );

-- The old FOR ALL policies let only the owner read sets, so shared workouts showed no detail.
DROP POLICY IF EXISTS workout_exercises_all ON public.workout_exercises;
CREATE POLICY workout_exercises_select ON public.workout_exercises
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id));
CREATE POLICY workout_exercises_owner_insert ON public.workout_exercises
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND w.user_id = auth.uid()));
CREATE POLICY workout_exercises_owner_update ON public.workout_exercises
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND w.user_id = auth.uid()));
CREATE POLICY workout_exercises_owner_delete ON public.workout_exercises
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND w.user_id = auth.uid()));

DROP POLICY IF EXISTS workout_sets_all ON public.workout_sets;
CREATE POLICY workout_sets_select ON public.workout_sets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workout_exercises we WHERE we.id = workout_sets.workout_exercise_id));
CREATE POLICY workout_sets_owner_insert ON public.workout_sets
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_sets.workout_exercise_id AND w.user_id = auth.uid()
  ));
CREATE POLICY workout_sets_owner_update ON public.workout_sets
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_sets.workout_exercise_id AND w.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_sets.workout_exercise_id AND w.user_id = auth.uid()
  ));
CREATE POLICY workout_sets_owner_delete ON public.workout_sets
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id
    WHERE we.id = workout_sets.workout_exercise_id AND w.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    private.can_view_content(user_id, visibility)
    OR EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.activity_id = activities.id AND p.deleted_at IS NULL AND private.can_view_content(p.user_id, p.visibility)
    )
  );

-- Legacy tables from 001, unused by the app. Same visibility rule.
DROP POLICY IF EXISTS activity_posts_select ON public.activity_posts;
CREATE POLICY activity_posts_select ON public.activity_posts
  FOR SELECT TO authenticated
  USING (private.can_view_content(user_id, visibility));
DROP POLICY IF EXISTS activity_reactions_select ON public.activity_reactions;
CREATE POLICY activity_reactions_select ON public.activity_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.activity_posts p WHERE p.id = activity_reactions.post_id));
DROP POLICY IF EXISTS activity_reactions_insert ON public.activity_reactions;
CREATE POLICY activity_reactions_insert ON public.activity_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.activity_posts p WHERE p.id = activity_reactions.post_id));

-- A correction must point at one of your own predictions.
DROP POLICY IF EXISTS user_corrections_insert ON public.user_corrections;
CREATE POLICY user_corrections_insert ON public.user_corrections
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.food_predictions fp WHERE fp.id = user_corrections.prediction_id AND fp.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. Follows. The old FOR ALL policy let a follower insert status 'accepted' on a
--    private profile, and stopped the followed user from accepting.
--    Accepting goes through respond_follow_request() in 008; there is no client UPDATE.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS follows_participant ON public.follows;
CREATE POLICY follows_select ON public.follows
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (follower_id, following_id)
    OR (
      status = 'accepted'
      AND NOT private.is_blocked_between(auth.uid(), follower_id)
      AND NOT private.is_blocked_between(auth.uid(), following_id)
    )
  );
CREATE POLICY follows_insert ON public.follows
  FOR INSERT TO authenticated
  WITH CHECK (
    follower_id = auth.uid()
    AND following_id <> auth.uid()
    AND NOT private.is_blocked_between(follower_id, following_id)
    AND (status = 'pending' OR NOT private.is_private_profile(following_id))
  );
CREATE POLICY follows_delete ON public.follows
  FOR DELETE TO authenticated
  USING (auth.uid() IN (follower_id, following_id));

-- ---------------------------------------------------------------------------
-- 5. Posts, comments, reactions.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS posts_visibility_select ON public.posts;
CREATE POLICY posts_visibility_select ON public.posts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND private.can_view_content(user_id, visibility));

-- Posts may only attach your own workout, activity and media.
DROP POLICY IF EXISTS posts_owner_write ON public.posts;
CREATE POLICY posts_owner_write ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (workout_id IS NULL OR EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = posts.workout_id AND w.user_id = auth.uid()))
    AND (activity_id IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = posts.activity_id AND a.user_id = auth.uid()))
    AND (media_path IS NULL OR split_part(media_path, '/', 1) = auth.uid()::text)
  );
DROP POLICY IF EXISTS posts_owner_update ON public.posts;
CREATE POLICY posts_owner_update ON public.posts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (workout_id IS NULL OR EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = posts.workout_id AND w.user_id = auth.uid()))
    AND (activity_id IS NULL OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = posts.activity_id AND a.user_id = auth.uid()))
    AND (media_path IS NULL OR split_part(media_path, '/', 1) = auth.uid()::text)
  );

-- The old policies only checked that the post existed. Subqueries on posts run under
-- the viewer's RLS, so these now mean "a post the viewer can see".
DROP POLICY IF EXISTS comments_visible_posts ON public.comments;
DROP POLICY IF EXISTS comments_owner_write ON public.comments;
CREATE POLICY comments_select ON public.comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id)
    AND NOT private.is_blocked_between(auth.uid(), user_id)
  );
CREATE POLICY comments_insert ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id));
CREATE POLICY comments_update ON public.comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY comments_delete ON public.comments
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS reactions_visible_posts ON public.post_reactions;
DROP POLICY IF EXISTS reactions_owner_write ON public.post_reactions;
CREATE POLICY reactions_select ON public.post_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_reactions.post_id));
CREATE POLICY reactions_insert ON public.post_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_reactions.post_id));
CREATE POLICY reactions_delete ON public.post_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Messaging. The old policies had two bugs:
--    - messages_member_read compared cm.conversation_id to itself, so any member of
--      any conversation could read every message.
--    - conversation_members_self_access queried its own table, which Postgres rejects
--      as infinite recursion.
--    Conversations are created through get_or_create_direct_conversation() in 008.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS conversations_member_access ON public.conversations;
CREATE POLICY conversations_member_access ON public.conversations
  FOR SELECT TO authenticated
  USING (private.is_conversation_member(id));

DROP POLICY IF EXISTS conversation_members_self_access ON public.conversation_members;
CREATE POLICY conversation_members_member_access ON public.conversation_members
  FOR SELECT TO authenticated
  USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS messages_member_read ON public.messages;
CREATE POLICY messages_member_read ON public.messages
  FOR SELECT TO authenticated
  USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS messages_member_send ON public.messages;
CREATE POLICY messages_member_send ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND private.is_conversation_member(conversation_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id <> auth.uid()
        AND private.is_blocked_between(auth.uid(), cm.user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Create a profile row for every new auth user, and backfill existing ones.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

INSERT INTO public.profiles (id)
SELECT u.id FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. User search with a bound parameter. No string-built filters.
--    A blank query returns people you do not follow yet, for the Discover list.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_profiles(q TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  is_private BOOLEAN,
  follow_status TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH term AS (
    SELECT '%' || replace(replace(replace(trim(COALESCE(q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern,
           trim(COALESCE(q, '')) = '' AS blank
  )
  SELECT pr.id, pr.username, pr.display_name, pr.avatar_url, pr.is_private, f.status
  FROM public.profiles pr
  CROSS JOIN term t
  LEFT JOIN public.follows f ON f.follower_id = auth.uid() AND f.following_id = pr.id
  WHERE pr.id <> auth.uid()
    AND pr.onboarded_at IS NOT NULL
    AND NOT private.is_blocked_between(auth.uid(), pr.id)
    AND (
      (t.blank AND f.id IS NULL)
      OR (NOT t.blank AND (pr.username ILIKE t.pattern OR pr.display_name ILIKE t.pattern))
    )
  ORDER BY
    CASE WHEN NOT t.blank AND lower(pr.username) = lower(trim(q)) THEN 0 ELSE 1 END,
    pr.created_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_profiles(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Storage. Paths are {user_id}/{uuid}.webp (or .jpg where the browser cannot
--    encode WebP). The first folder must be the uploader's id.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', TRUE, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png']),
  ('post-media', 'post-media', FALSE, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png']),
  ('progress-photos', 'progress-photos', FALSE, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS fitos_avatars_read ON storage.objects;
DROP POLICY IF EXISTS fitos_avatars_insert ON storage.objects;
DROP POLICY IF EXISTS fitos_avatars_update ON storage.objects;
DROP POLICY IF EXISTS fitos_avatars_delete ON storage.objects;
DROP POLICY IF EXISTS fitos_post_media_read ON storage.objects;
DROP POLICY IF EXISTS fitos_post_media_insert ON storage.objects;
DROP POLICY IF EXISTS fitos_post_media_delete ON storage.objects;
DROP POLICY IF EXISTS fitos_progress_photos_owner ON storage.objects;

-- Avatars: anyone can read (public bucket); you write only inside your own folder.
CREATE POLICY fitos_avatars_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');
CREATE POLICY fitos_avatars_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY fitos_avatars_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY fitos_avatars_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Post media: readable when the post that references it is visible to you.
CREATE POLICY fitos_post_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'post-media'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.posts p WHERE p.media_path = objects.name)
    )
  );
CREATE POLICY fitos_post_media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY fitos_post_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'post-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Progress photos: private, owner only.
CREATE POLICY fitos_progress_photos_owner ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 10. Realtime. Supabase checks each subscriber's RLS before delivering a change.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['messages', 'posts', 'comments', 'post_reactions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 11. The anon role is only used before sign-in, for auth endpoints.
--     It needs no table access at all.
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
