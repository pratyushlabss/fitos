-- FitOS social identity and graph schema.
-- Supabase Auth remains the identity provider; profiles.id is auth.users.id.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS public.mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK (post_type IN ('workout', 'activity', 'achievement', 'challenge', 'text')),
  body TEXT,
  workout_id UUID REFERENCES public.workouts (id) ON DELETE SET NULL,
  activity_id UUID REFERENCES public.activities (id) ON DELETE SET NULL,
  visibility public.visibility_level NOT NULL DEFAULT 'friends',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'kudos')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, kind)
);

CREATE INDEX IF NOT EXISTS follows_follower_status_idx ON public.follows (follower_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS follows_following_status_idx ON public.follows (following_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_created_idx ON public.posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_visibility_created_idx ON public.posts (visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_post_created_idx ON public.comments (post_id, created_at DESC);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY follows_participant ON public.follows
  FOR ALL USING (auth.uid() = follower_id OR auth.uid() = following_id)
  WITH CHECK (auth.uid() = follower_id);
CREATE POLICY blocks_owner ON public.blocks
  FOR ALL USING (auth.uid() = blocker_id) WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY mutes_owner ON public.mutes
  FOR ALL USING (auth.uid() = muter_id) WITH CHECK (auth.uid() = muter_id);
CREATE POLICY posts_visibility_select ON public.posts
  FOR SELECT USING (
    auth.uid() = user_id
    OR (visibility = 'public' AND deleted_at IS NULL)
    OR (
      visibility = 'friends'
      AND EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = user_id
          AND f.status = 'accepted'
      )
    )
  );
CREATE POLICY posts_owner_write ON public.posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY posts_owner_update ON public.posts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY posts_owner_delete ON public.posts
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY comments_visible_posts ON public.comments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));
CREATE POLICY comments_owner_write ON public.comments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY reactions_visible_posts ON public.post_reactions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));
CREATE POLICY reactions_owner_write ON public.post_reactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
