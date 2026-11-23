-- Hard AI spend guard. ai_usage becomes one row per provider request with tokens and estimated cost.
-- Edge functions reserve a row before calling the AI (all three limits checked under one lock),
-- then record tokens and cost after the call, or release the row if the call failed.
-- Apply after 010_rag.sql.

ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS food_scan_usage_pkey;
ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_pkey;
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tokens_in INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS est_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('reserved', 'done')),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.ai_usage ADD PRIMARY KEY (id);
ALTER TABLE public.ai_usage ALTER COLUMN day SET DEFAULT (now() AT TIME ZONE 'UTC')::date;
ALTER TABLE public.ai_usage ALTER COLUMN calls SET DEFAULT 1;
CREATE INDEX IF NOT EXISTS ai_usage_day_idx ON public.ai_usage (day);
CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx ON public.ai_usage (user_id, day);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON public.ai_usage (created_at);

DROP FUNCTION IF EXISTS public.consume_ai_call(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.refund_ai_call(UUID);

-- Checks the user's calls today, global calls today and global spend this calendar month (UTC),
-- and reserves one call if all pass. Serialised with an advisory lock so parallel requests can't overshoot.
CREATE OR REPLACE FUNCTION public.ai_guard_reserve(
  p_user UUID,
  p_action TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_user_daily_limit INTEGER,
  p_global_daily_cap INTEGER,
  p_monthly_budget_usd NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_month_start TIMESTAMPTZ := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_user_calls INTEGER;
  v_global_calls INTEGER;
  v_month_spend NUMERIC;
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fitos_ai_guard'));
  SELECT COALESCE(sum(calls), 0) INTO v_user_calls FROM public.ai_usage WHERE user_id = p_user AND day = v_today;
  SELECT COALESCE(sum(calls), 0) INTO v_global_calls FROM public.ai_usage WHERE day = v_today;
  SELECT COALESCE(sum(est_cost_usd), 0) INTO v_month_spend FROM public.ai_usage WHERE created_at >= v_month_start;

  IF v_month_spend >= p_monthly_budget_usd THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'monthly_budget', 'month_spend_usd', v_month_spend);
  END IF;
  IF v_global_calls >= p_global_daily_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'global_daily_cap', 'global_calls', v_global_calls);
  END IF;
  IF v_user_calls >= p_user_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_daily_limit', 'user_calls', v_user_calls);
  END IF;

  INSERT INTO public.ai_usage (user_id, day, calls, action, provider, model, status)
  VALUES (p_user, v_today, 1, p_action, p_provider, p_model, 'reserved')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('allowed', true, 'usage_id', v_id, 'user_calls', v_user_calls + 1, 'global_calls', v_global_calls + 1, 'month_spend_usd', v_month_spend);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_guard_record(p_id UUID, p_tokens_in INTEGER, p_tokens_out INTEGER, p_cost_usd NUMERIC)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ai_usage
  SET tokens_in = GREATEST(COALESCE(p_tokens_in, 0), 0),
      tokens_out = GREATEST(COALESCE(p_tokens_out, 0), 0),
      est_cost_usd = GREATEST(COALESCE(p_cost_usd, 0), 0),
      status = 'done'
  WHERE id = p_id;
$$;

-- A request that never produced a billable response gives its slot back.
CREATE OR REPLACE FUNCTION public.ai_guard_release(p_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM public.ai_usage WHERE id = p_id AND status = 'reserved';
$$;

CREATE OR REPLACE FUNCTION public.ai_spend_summary()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'month_spend_usd', COALESCE((SELECT sum(est_cost_usd) FROM public.ai_usage WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0),
    'month_calls', COALESCE((SELECT sum(calls) FROM public.ai_usage WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0),
    'today_calls', COALESCE((SELECT sum(calls) FROM public.ai_usage WHERE day = (now() AT TIME ZONE 'UTC')::date), 0),
    'today_users', (SELECT count(DISTINCT user_id) FROM public.ai_usage WHERE day = (now() AT TIME ZONE 'UTC')::date),
    'today_tokens_in', COALESCE((SELECT sum(tokens_in) FROM public.ai_usage WHERE day = (now() AT TIME ZONE 'UTC')::date), 0),
    'today_tokens_out', COALESCE((SELECT sum(tokens_out) FROM public.ai_usage WHERE day = (now() AT TIME ZONE 'UTC')::date), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.ai_guard_reserve(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_guard_record(UUID, INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_guard_release(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_spend_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_guard_reserve(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_guard_record(UUID, INTEGER, INTEGER, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_guard_release(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_spend_summary() TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
