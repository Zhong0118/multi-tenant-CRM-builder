BEGIN;
CREATE TABLE public.mail_deliveries (
  id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('code_bind','code_reverify','code_change','code_reset','test','password_changed','password_reset','email_changed','email_removed','new_device')),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid, member_id uuid,
  email_version integer NOT NULL,
  masked_email text NOT NULL,
  old_email text CHECK (old_email IS NULL OR kind IN ('email_changed','email_removed')),
  device text, network text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('pending','claimed','sending','retry_wait','sent','failed','skipped','unknown')),
  attempts integer NOT NULL DEFAULT 0,
  token uuid, lease_until timestamptz,
  error_code text, provider_id varchar(64), finished_at timestamptz
);
CREATE INDEX mail_deliveries_due ON public.mail_deliveries(status,next_attempt_at);
CREATE INDEX mail_deliveries_lease ON public.mail_deliveries(lease_until) WHERE token IS NOT NULL;
CREATE INDEX mail_deliveries_finished ON public.mail_deliveries(finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX mail_test_throttle ON public.mail_deliveries(user_id,created_at DESC) WHERE kind='test';
ALTER TABLE public.mail_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_deliveries FROM PUBLIC, crm_app;

CREATE FUNCTION public.mail_enqueue(p_key text,p_kind text,p_user uuid,p_version integer,p_mask text,p_old text,p_device text,p_network text,p_time timestamptz)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH added AS (
    INSERT INTO public.mail_deliveries(dedupe_key,kind,user_id,email_version,masked_email,old_email,device,network,occurred_at,status)
    SELECT p_key,p_kind,p_user,p_version,p_mask,p_old,p_device,p_network,p_time,'pending'
    WHERE p_kind IN ('password_changed','password_reset','email_changed','email_removed','new_device')
      AND p_time > now()-interval '90 days'
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING 1
  ) SELECT EXISTS(SELECT FROM added)
$$;

-- A synchronous attempt is never eligible for the worker's claim query.
CREATE FUNCTION public.mail_begin_direct(p_id uuid,p_kind text,p_user uuid,p_version integer,p_mask text,p_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH added AS (
    INSERT INTO public.mail_deliveries(id,dedupe_key,kind,user_id,email_version,masked_email,occurred_at,status,attempts,token,lease_until)
    SELECT p_id,p_kind||':'||p_id,p_kind,p_user,p_version,p_mask,now(),'sending',1,p_token,now()+interval '1 minute'
    WHERE p_kind IN ('code_bind','code_reverify','code_change','code_reset','test')
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT EXISTS(SELECT FROM added)
$$;

CREATE FUNCTION public.mail_test_recent(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.mail_deliveries WHERE kind='test' AND user_id=p_user AND created_at>now()-interval '1 minute')
$$;

CREATE FUNCTION public.mail_claim(p_limit integer)
RETURNS TABLE(id uuid,token uuid,kind text,user_id uuid,email_version integer,old_email text,device text,network text,occurred_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH due AS (
    SELECT m.id FROM public.mail_deliveries m
    WHERE ((m.status IN ('pending','retry_wait') AND m.next_attempt_at <= now()) OR
           (m.status='claimed' AND m.lease_until <= now())) AND m.occurred_at>now()-interval '90 days'
    ORDER BY m.next_attempt_at,m.id LIMIT greatest(0,least(p_limit,25)) FOR UPDATE SKIP LOCKED
  )
  UPDATE public.mail_deliveries m SET token=gen_random_uuid(), lease_until=now()+interval '1 minute',status='claimed'
  FROM due WHERE m.id=due.id
  RETURNING m.id,m.token,m.kind,m.user_id,m.email_version,m.old_email,m.device,m.network,m.occurred_at
$$;

CREATE FUNCTION public.mail_start(p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH changed AS (
    UPDATE public.mail_deliveries SET status='sending',attempts=attempts+1,lease_until=now()+interval '1 minute'
    WHERE id=p_id AND token=p_token AND status='claimed' AND lease_until>now() RETURNING 1
  ) SELECT EXISTS(SELECT FROM changed)
$$;

CREATE FUNCTION public.mail_finish(p_id uuid,p_token uuid,p_action text,p_error text,p_provider text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH outcome AS (
    SELECT id, CASE WHEN p_action='retry' AND attempts<6 AND kind NOT IN ('code_bind','code_reverify','code_change','code_reset','test')
      THEN 'retry_wait' WHEN p_action='retry' THEN 'failed' ELSE p_action END AS result
    FROM public.mail_deliveries WHERE id=p_id AND token=p_token AND
      ((status='sending' AND p_action IN ('sent','retry','failed','unknown')) OR (status='claimed' AND p_action='skipped'))
      AND (p_error IS NULL OR p_error IN ('quota','temporary','connection','uncertain','recipient','auth','rejected','ineligible'))
      AND (p_provider IS NULL OR p_provider ~ '^[a-zA-Z0-9_-]{1,64}$')
    FOR UPDATE
  )
  UPDATE public.mail_deliveries m SET status=result,error_code=p_error,provider_id=p_provider,
    old_email=CASE WHEN result='retry_wait' THEN m.old_email END,
    device=CASE WHEN result='retry_wait' THEN m.device END,network=CASE WHEN result='retry_wait' THEN m.network END,
    next_attempt_at=CASE WHEN result='retry_wait' THEN now()+make_interval(mins=>(1 << (attempts-1))) ELSE m.next_attempt_at END,
    finished_at=CASE WHEN result!='retry_wait' THEN now() END,token=NULL,lease_until=NULL
  FROM outcome WHERE m.id=outcome.id RETURNING m.status
$$;

CREATE FUNCTION public.mail_maintain() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE affected integer;
BEGIN
  WITH expired AS (SELECT id FROM public.mail_deliveries WHERE (status='sending' AND lease_until<=now()) OR
     (status IN ('pending','retry_wait','claimed') AND occurred_at<=now()-interval '90 days') LIMIT 500 FOR UPDATE SKIP LOCKED)
  UPDATE public.mail_deliveries m SET status=CASE WHEN m.status='sending' THEN 'unknown' ELSE 'skipped' END,
    error_code=CASE WHEN m.status='sending' THEN 'uncertain' ELSE 'ineligible' END,
    old_email=NULL,device=NULL,network=NULL,token=NULL,lease_until=NULL,finished_at=now() FROM expired WHERE expired.id=m.id;
  WITH stale AS (SELECT id FROM public.mail_deliveries WHERE finished_at<now()-interval '90 days' LIMIT 500 FOR UPDATE SKIP LOCKED)
  DELETE FROM public.mail_deliveries m USING stale WHERE stale.id=m.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END
$$;

CREATE FUNCTION public.mail_statistics() RETURNS TABLE(kind text,status text,count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.kind,m.status,count(*)::integer FROM public.mail_deliveries m WHERE finished_at>=now()-interval '7 days'
  GROUP BY m.kind,m.status ORDER BY m.kind,m.status
$$;

DO $$
DECLARE signature regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.mail_enqueue(text,text,uuid,integer,text,text,text,text,timestamptz)'::regprocedure,
    'public.mail_begin_direct(uuid,text,uuid,integer,text,uuid)'::regprocedure,
    'public.mail_test_recent(uuid)'::regprocedure,'public.mail_claim(integer)'::regprocedure,
    'public.mail_start(uuid,uuid)'::regprocedure,'public.mail_finish(uuid,uuid,text,text,text)'::regprocedure,
    'public.mail_maintain()'::regprocedure,'public.mail_statistics()'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_app',signature);
  END LOOP;
END
$$;

COMMIT;
