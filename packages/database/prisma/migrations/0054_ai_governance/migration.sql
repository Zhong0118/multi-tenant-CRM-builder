BEGIN;

CREATE TABLE ai_plans (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(), name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
 description text NOT NULL DEFAULT '', features text[] NOT NULL,
 monthly_tokens bigint NOT NULL CHECK (monthly_tokens >= 0), assignable boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 CHECK (array_position(features,NULL) IS NULL AND features <@ ARRAY['assistant','write_proposal','communication','filter','table_builder']),
 CHECK (NOT ('write_proposal'=ANY(features)) OR 'assistant'=ANY(features))
);
CREATE TABLE ai_platform_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), default_plan_id uuid REFERENCES ai_plans,
 disabled boolean NOT NULL DEFAULT false, reason text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_ai_configs (
 tenant_id uuid PRIMARY KEY REFERENCES tenants ON DELETE CASCADE, plan_id uuid REFERENCES ai_plans,
 allocation text NOT NULL DEFAULT 'shared' CHECK (allocation IN ('shared','equal')), version integer NOT NULL DEFAULT 1 CHECK (version>0)
);
CREATE INDEX tenant_ai_configs_plan ON tenant_ai_configs(plan_id,tenant_id);
CREATE TABLE ai_tenant_months (
 tenant_id uuid NOT NULL REFERENCES tenant_ai_configs ON DELETE CASCADE, month date NOT NULL CHECK (extract(day FROM month)=1),
 extra_tokens bigint NOT NULL DEFAULT 0 CHECK (extra_tokens>=0),
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0), output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
 notified_80 boolean NOT NULL DEFAULT false, notified_100 boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,month)
);
CREATE TABLE ai_member_months (
 tenant_id uuid NOT NULL, month date NOT NULL, member_id uuid NOT NULL,
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0), output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0), PRIMARY KEY(tenant_id,month,member_id),
 FOREIGN KEY(tenant_id,month) REFERENCES ai_tenant_months ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_model_calls (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, member_id uuid NOT NULL, month date NOT NULL, local_date date NOT NULL,
 feature text NOT NULL CHECK(feature IN ('assistant','communication','filter','table_builder')), provider text NOT NULL, model text NOT NULL,
 request_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 ended_at timestamptz, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','failed','timeout','cancelled','unsent')),
 reserved_input bigint NOT NULL CHECK(reserved_input>=0), reserved_output bigint NOT NULL CHECK(reserved_output>0),
 input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0), output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
 input_estimated boolean NOT NULL DEFAULT false, output_estimated boolean NOT NULL DEFAULT false,
 recovered boolean NOT NULL DEFAULT false,
 excess_tokens bigint GENERATED ALWAYS AS (greatest(0::bigint,input_tokens+output_tokens-reserved_input-reserved_output)) STORED,
 FOREIGN KEY(tenant_id,month,member_id) REFERENCES ai_member_months ON DELETE CASCADE
);
CREATE INDEX ai_model_calls_expiry ON ai_model_calls(tenant_id,expires_at,id) WHERE status='pending';
CREATE INDEX ai_model_calls_request ON ai_model_calls(tenant_id,request_id);
CREATE INDEX ai_model_calls_anomaly ON ai_model_calls(model) INCLUDE(excess_tokens) WHERE excess_tokens>0;
CREATE TABLE ai_daily_usage (
 tenant_id uuid NOT NULL REFERENCES tenant_ai_configs ON DELETE CASCADE, local_date date NOT NULL, feature text NOT NULL,
 calls bigint NOT NULL DEFAULT 0 CHECK(calls>=0), input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens>=0),
 output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens>=0), proposals bigint NOT NULL DEFAULT 0 CHECK(proposals>=0),
 confirmations bigint NOT NULL DEFAULT 0 CHECK(confirmations>=0), PRIMARY KEY(tenant_id,local_date,feature)
);
CREATE TABLE ai_operation_records (
 id uuid NOT NULL, tenant_id uuid NOT NULL REFERENCES tenant_ai_configs ON DELETE CASCADE, member_id uuid NOT NULL,
 feature text NOT NULL, source text NOT NULL CHECK(source IN ('proposal','draft','blueprint','denial','provider')), status text NOT NULL,
 request_id text, request_text text, changes jsonb NOT NULL DEFAULT '{}', object_id uuid, record_id uuid,
 confirmed_by_member_id uuid, audit_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,confirmed_by_member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX ai_operation_records_time ON ai_operation_records(tenant_id,created_at DESC,id DESC);
CREATE INDEX ai_operation_records_member_time ON ai_operation_records(tenant_id,member_id,created_at DESC,id DESC);
CREATE TABLE ai_private_audit_requests (
 tenant_id uuid NOT NULL REFERENCES tenant_ai_configs ON DELETE CASCADE, request_id text NOT NULL, PRIMARY KEY(tenant_id,request_id)
);
CREATE TABLE ai_quota_additions (
 tenant_id uuid NOT NULL REFERENCES tenant_ai_configs ON DELETE CASCADE, month date NOT NULL, amount bigint NOT NULL CHECK(amount>0),
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200), PRIMARY KEY(tenant_id,key)
);
WITH trial AS (
 INSERT INTO ai_plans(name,features,monthly_tokens) VALUES ('默认 AI 套餐',ARRAY['assistant','write_proposal','communication','filter','table_builder'],10000000) RETURNING id
) INSERT INTO ai_platform_settings(default_plan_id) SELECT id FROM trial;
INSERT INTO tenant_ai_configs(tenant_id,plan_id) SELECT t.id,s.default_plan_id FROM tenants t CROSS JOIN ai_platform_settings s;

-- The runtime role can only read ledger rows. Narrow functions below run as a
-- non-login role, which has no access to messages or the CRM record payload.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='crm_ai_writer') THEN
  CREATE ROLE crm_ai_writer NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE, CREATE ON SCHEMA public TO crm_ai_writer;
GRANT SELECT ON users,tenants,tenant_members,object_publications,ai_record_drafts TO crm_ai_writer;
CREATE POLICY ai_writer_tenants ON tenants FOR SELECT TO crm_ai_writer USING(true);
CREATE POLICY ai_writer_members ON tenant_members FOR SELECT TO crm_ai_writer USING(true);
CREATE POLICY ai_writer_publications ON object_publications FOR SELECT TO crm_ai_writer USING(true);
CREATE POLICY ai_writer_drafts ON ai_record_drafts FOR SELECT TO crm_ai_writer USING(true);
GRANT INSERT ON member_notifications TO crm_ai_writer;
CREATE POLICY ai_writer_thresholds ON member_notifications FOR INSERT TO crm_ai_writer WITH CHECK(kind IN ('AI_QUOTA_80','AI_QUOTA_100'));

DO $$ DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['ai_plans','ai_platform_settings','tenant_ai_configs','ai_tenant_months','ai_member_months','ai_model_calls','ai_daily_usage','ai_operation_records','ai_quota_additions','ai_private_audit_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY ai_writer_access ON %I TO crm_ai_writer USING(true) WITH CHECK(true)',n);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO crm_ai_writer',n);
  EXECUTE format('GRANT SELECT ON %I TO crm_app',n);
 END LOOP;
END $$;
CREATE FUNCTION ai_is_platform() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (SELECT FROM users WHERE id=nullif(current_setting('app.user_id',true),'')::uuid AND status='ACTIVE' AND is_platform_admin)
$$;
-- This probe works even where the normal membership policies expose only the caller.
CREATE FUNCTION ai_is_member(t uuid, m uuid DEFAULT NULL, admin_only boolean DEFAULT false) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
  SELECT FROM tenant_members tm JOIN users u ON u.id=tm.user_id JOIN tenants c ON c.id=tm.tenant_id
  WHERE tm.tenant_id=t AND (m IS NULL OR tm.id=m) AND tm.status='ACTIVE' AND c.status='ACTIVE' AND u.status='ACTIVE'
  AND u.id=nullif(current_setting('app.user_id',true),'')::uuid AND (NOT admin_only OR tm.role='TENANT_ADMIN'))
$$;
CREATE POLICY platform_plans ON ai_plans TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
CREATE POLICY assigned_plan ON ai_plans FOR SELECT TO crm_app USING(EXISTS(SELECT FROM tenant_ai_configs c WHERE c.plan_id=id AND ai_is_member(c.tenant_id)));
CREATE POLICY platform_settings ON ai_platform_settings TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
CREATE POLICY member_settings ON ai_platform_settings FOR SELECT TO crm_app USING(ai_is_member(nullif(current_setting('app.tenant_id',true),'')::uuid));
CREATE POLICY config_read ON tenant_ai_configs FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY allocation_write ON tenant_ai_configs FOR UPDATE TO crm_app USING(ai_is_member(tenant_id,NULL,true)) WITH CHECK(ai_is_member(tenant_id,NULL,true));
CREATE POLICY month_read ON ai_tenant_months FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY daily_read ON ai_daily_usage FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id,NULL,true));
CREATE POLICY member_month_read ON ai_member_months FOR SELECT TO crm_app USING(ai_is_member(tenant_id,member_id) OR ai_is_member(tenant_id,NULL,true));
CREATE POLICY calls_read ON ai_model_calls FOR SELECT TO crm_app USING(ai_is_member(tenant_id,member_id) OR ai_is_member(tenant_id,NULL,true));
CREATE POLICY ops_admin ON ai_operation_records FOR SELECT TO crm_app USING(ai_is_member(tenant_id,NULL,true));
CREATE POLICY quota_additions_read ON ai_quota_additions FOR SELECT TO crm_app USING(ai_is_platform());
GRANT INSERT,UPDATE,DELETE ON ai_plans TO crm_app;
GRANT UPDATE ON ai_platform_settings TO crm_app;
GRANT UPDATE(allocation,version) ON tenant_ai_configs TO crm_app;
CREATE POLICY ai_platform_audit ON audit_logs FOR INSERT TO crm_app WITH CHECK(ai_is_platform() AND actor_id=nullif(current_setting('app.user_id',true),'')::uuid AND action IN ('ai.plan_assigned','ai.quota_added'));

CREATE FUNCTION ai_configure_tenant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO tenant_ai_configs(tenant_id,plan_id)
 SELECT NEW.id,default_plan_id FROM ai_platform_settings WHERE id FOR SHARE;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_configure_tenant AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION ai_configure_tenant();

CREATE FUNCTION ai_assign_plan(t uuid,p uuid,v integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 IF p IS NOT NULL AND NOT EXISTS(SELECT FROM ai_plans WHERE id=p AND assignable FOR SHARE) THEN RAISE invalid_parameter_value; END IF;
 UPDATE tenant_ai_configs SET plan_id=p,version=version+1 WHERE tenant_id=t AND version=v;
 RETURN FOUND;
END $$;
CREATE FUNCTION ai_add_quota(t uuid,mo date,tokens bigint,k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old ai_quota_additions%ROWTYPE;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 PERFORM FROM tenant_ai_configs WHERE tenant_id=t FOR NO KEY UPDATE;
 SELECT * INTO old FROM ai_quota_additions WHERE tenant_id=t AND key=k;
 IF FOUND THEN
  IF old.amount<>tokens OR old.month<>mo THEN RAISE invalid_parameter_value; END IF;
  RETURN false;
 END IF;
 IF mo IS DISTINCT FROM (SELECT date_trunc('month',clock_timestamp() AT TIME ZONE timezone)::date FROM tenants WHERE id=t) THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO ai_quota_additions VALUES(t,mo,tokens,k);
 INSERT INTO ai_tenant_months(tenant_id,month,extra_tokens) VALUES(t,mo,tokens)
 ON CONFLICT(tenant_id,month) DO UPDATE SET extra_tokens=ai_tenant_months.extra_tokens+excluded.extra_tokens;
 RETURN true;
END $$;

CREATE FUNCTION ai_anomaly_summary() RETURNS TABLE(model text,calls bigint,excess_tokens bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT c.model,count(*),sum(c.excess_tokens)::bigint FROM ai_model_calls c WHERE ai_is_platform() AND c.excess_tokens>0 GROUP BY c.model
$$;

-- Returns the rejection reason so the caller can commit a denial before
-- translating it to an HTTP exception. A confirmation holds these locks to commit.
CREATE FUNCTION ai_feature_gate(t uuid,m uuid,f text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE off_switch boolean; plan uuid;
BEGIN
 IF NOT coalesce(ai_is_member(t,m),false) THEN RAISE insufficient_privilege; END IF;
 SELECT disabled INTO STRICT off_switch FROM ai_platform_settings WHERE id FOR SHARE;
 IF off_switch THEN RETURN 'AI_PLATFORM_DISABLED'; END IF;
 SELECT plan_id INTO plan FROM tenant_ai_configs WHERE tenant_id=t FOR SHARE;
 IF NOT EXISTS(SELECT FROM ai_plans WHERE id=plan AND f=ANY(features) FOR SHARE) THEN RETURN 'AI_FEATURE_NOT_INCLUDED'; END IF;
 IF f='table_builder' AND NOT ai_is_member(t,m,true) THEN RETURN 'OBJECT_ACTION_FORBIDDEN'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION ai_record_denial(t uuid,m uuid,f text,code text,r text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT coalesce(ai_is_member(t,m),false) THEN RAISE insufficient_privilege; END IF;
 IF code NOT IN ('AI_PLATFORM_DISABLED','AI_FEATURE_NOT_INCLUDED','AI_TENANT_QUOTA_EXHAUSTED','AI_MEMBER_QUOTA_EXHAUSTED',
                 'AI_REQUEST_BUDGET_INSUFFICIENT','AI_BUDGET_RESERVED','RATE_LIMITED','OBJECT_ACTION_FORBIDDEN','AI_PROVIDER_UNAVAILABLE') THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id)
 VALUES(crm_uuid_v7(),t,m,f,'denial',code,r);
END $$;

-- Internal settlement. Config, company month and member month are locked in the
-- same order as admission, even for an expired call in the preceding month.
CREATE FUNCTION ai_finish_call(t uuid,cid uuid,result text,i bigint,o bigint,by_recovery boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c ai_model_calls%ROWTYPE; ni bigint; no_ bigint; di bigint; do_ bigint; held bigint;
 pending boolean; next_status text; ei boolean; eo boolean;
BEGIN
 PERFORM FROM tenant_ai_configs WHERE tenant_id=t FOR NO KEY UPDATE;
 SELECT * INTO STRICT c FROM ai_model_calls WHERE tenant_id=t AND id=cid;
 pending:=c.status='pending';
 IF c.status='unsent' OR (NOT pending AND NOT c.recovered AND NOT (c.input_estimated AND i IS NOT NULL OR c.output_estimated AND o IS NOT NULL)) THEN RETURN; END IF;
 IF result NOT IN ('success','failed','cancelled','timeout','unsent') OR i<0 OR o<0 THEN RAISE invalid_parameter_value; END IF;
 IF result='unsent' AND NOT pending AND NOT c.recovered THEN RETURN; END IF;
 next_status:=CASE WHEN pending OR c.recovered THEN result ELSE c.status END;
 ei:=result<>'unsent' AND i IS NULL AND (pending OR c.input_estimated);
 eo:=result<>'unsent' AND o IS NULL AND (pending OR c.output_estimated);
 ni:=CASE WHEN result='unsent' THEN 0 WHEN pending OR c.input_estimated THEN coalesce(i,c.reserved_input) ELSE c.input_tokens END;
 no_:=CASE WHEN result='unsent' THEN 0 WHEN pending OR c.output_estimated THEN coalesce(o,c.reserved_output) ELSE c.output_tokens END;
 di:=ni-c.input_tokens; do_:=no_-c.output_tokens;
 held:=CASE WHEN pending THEN c.reserved_input+c.reserved_output ELSE 0 END;
 UPDATE ai_tenant_months SET input_tokens=input_tokens+di,output_tokens=output_tokens+do_,reserved_tokens=reserved_tokens-held WHERE tenant_id=t AND month=c.month;
 UPDATE ai_member_months SET input_tokens=input_tokens+di,output_tokens=output_tokens+do_,reserved_tokens=reserved_tokens-held WHERE tenant_id=t AND month=c.month AND member_id=c.member_id;
 UPDATE ai_model_calls SET status=next_status,ended_at=CASE WHEN pending OR c.recovered THEN clock_timestamp() ELSE ended_at END,
  input_tokens=ni,output_tokens=no_,input_estimated=ei,output_estimated=eo,recovered=by_recovery WHERE id=cid;
 IF pending AND result<>'unsent' THEN
  INSERT INTO ai_daily_usage(tenant_id,local_date,feature,calls,input_tokens,output_tokens) VALUES(t,c.local_date,c.feature,1,ni,no_)
  ON CONFLICT(tenant_id,local_date,feature) DO UPDATE SET calls=ai_daily_usage.calls+1,input_tokens=ai_daily_usage.input_tokens+excluded.input_tokens,output_tokens=ai_daily_usage.output_tokens+excluded.output_tokens;
 ELSIF NOT pending THEN
  UPDATE ai_daily_usage SET calls=calls-CASE WHEN result='unsent' THEN 1 ELSE 0 END,input_tokens=input_tokens+di,output_tokens=output_tokens+do_
   WHERE tenant_id=t AND local_date=c.local_date AND feature=c.feature;
 END IF;
 IF next_status IN ('failed','cancelled','timeout') THEN
  INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id,created_at)
  VALUES(cid,t,c.member_id,c.feature,'provider',next_status,c.request_id,c.started_at)
  ON CONFLICT(tenant_id,id) DO UPDATE SET status=excluded.status,updated_at=clock_timestamp() WHERE ai_operation_records.source='provider';
 ELSIF c.recovered THEN
  DELETE FROM ai_operation_records WHERE tenant_id=t AND id=cid AND source='provider';
 END IF;
END $$;
CREATE FUNCTION ai_recover_expired(t uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE key uuid; n integer:=0;
BEGIN
 IF NOT (coalesce(ai_is_member(t),false) OR ai_is_platform()) THEN RAISE insufficient_privilege; END IF;
 PERFORM FROM tenant_ai_configs WHERE tenant_id=t FOR NO KEY UPDATE;
 FOR key IN SELECT id FROM ai_model_calls WHERE tenant_id=t AND status='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LOOP
  PERFORM ai_finish_call(t,key,'timeout',NULL,NULL,true);
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
-- Platform pagination can sort current usage without taking a lock on every
-- company. Recheck pending status inside each tenant lock.
CREATE FUNCTION ai_recover_platform_expired() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t uuid; n integer:=0;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 FOR t IN SELECT DISTINCT tenant_id FROM ai_model_calls WHERE status='pending' AND expires_at<=statement_timestamp() ORDER BY tenant_id LOOP
  n:=n+ai_recover_expired(t);
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION ai_settle_call(t uuid,m uuid,cid uuid,result text,i bigint,o bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- A provider receipt remains payable after the caller has been deactivated.
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
  SELECT FROM ai_model_calls c JOIN tenant_members tm ON tm.tenant_id=c.tenant_id AND tm.id=c.member_id
  WHERE c.tenant_id=t AND c.id=cid AND tm.id=m AND tm.user_id=nullif(current_setting('app.user_id',true),'')::uuid
 ) THEN RAISE insufficient_privilege; END IF;
 PERFORM ai_finish_call(t,cid,result,i,o,false);
END $$;

CREATE FUNCTION ai_budget_error(cap numeric,spent numeric,held bigint,required bigint,exhausted text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN cap<=spent THEN exhausted WHEN cap-spent<required THEN 'AI_REQUEST_BUDGET_INSUFFICIENT'
  WHEN cap-spent-held<required THEN 'AI_BUDGET_RESERVED' END
$$;
CREATE FUNCTION ai_reserve_call(t uuid,m uuid,cid uuid,r text,f text,p text,model_name text,i bigint,o bigint,deadline timestamptz)
 RETURNS TABLE(code text,recovery_date date) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE local_day date; mo date; cap numeric; active_count bigint; tm ai_tenant_months%ROWTYPE; mm ai_member_months%ROWTYPE; allocation_mode text;
BEGIN
 IF NOT coalesce(ai_is_member(t,m),false) THEN RAISE insufficient_privilege; END IF;
 IF i<0 OR o IS DISTINCT FROM (CASE f WHEN 'assistant' THEN 4096 WHEN 'communication' THEN 4000 WHEN 'filter' THEN 3500 WHEN 'table_builder' THEN 16000 END)
  OR f NOT IN ('assistant','communication','filter','table_builder') OR deadline<=clock_timestamp() THEN RAISE invalid_parameter_value; END IF;
 -- Acquire the global read lock before taking any company lock. Platform changes
 -- serialize on the same singleton and then acquire company locks.
 PERFORM FROM ai_platform_settings WHERE id FOR SHARE;
 PERFORM ai_recover_expired(t);
 code:=ai_feature_gate(t,m,f);
 SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO STRICT local_day FROM tenants WHERE id=t;
 mo:=date_trunc('month',local_day)::date;
 recovery_date:=(mo+interval '1 month')::date;
 IF code IS NULL THEN
  SELECT p1.monthly_tokens,tc.allocation INTO STRICT cap,allocation_mode FROM tenant_ai_configs tc JOIN ai_plans p1 ON p1.id=tc.plan_id WHERE tc.tenant_id=t;
  INSERT INTO ai_tenant_months(tenant_id,month) VALUES(t,mo) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT tm FROM ai_tenant_months WHERE tenant_id=t AND month=mo FOR UPDATE;
  cap:=cap+tm.extra_tokens;
  code:=ai_budget_error(cap,tm.input_tokens::numeric+tm.output_tokens,tm.reserved_tokens,i+o,'AI_TENANT_QUOTA_EXHAUSTED');
  IF code IS NULL THEN
   INSERT INTO ai_member_months(tenant_id,month,member_id) VALUES(t,mo,m) ON CONFLICT DO NOTHING;
   SELECT * INTO STRICT mm FROM ai_member_months WHERE tenant_id=t AND month=mo AND member_id=m FOR UPDATE;
   IF allocation_mode='equal' THEN
    SELECT count(*) INTO active_count FROM tenant_members a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=t AND a.status='ACTIVE' AND u.status='ACTIVE';
    code:=ai_budget_error(trunc(cap/greatest(active_count,1)),mm.input_tokens::numeric+mm.output_tokens,mm.reserved_tokens,i+o,'AI_MEMBER_QUOTA_EXHAUSTED');
   END IF;
  END IF;
 END IF;
 IF code IS NULL THEN
  INSERT INTO ai_model_calls(id,tenant_id,member_id,month,local_date,feature,provider,model,request_id,reserved_input,reserved_output,expires_at)
  VALUES(cid,t,m,mo,local_day,f,p,model_name,r,i,o,deadline);
  UPDATE ai_tenant_months SET reserved_tokens=reserved_tokens+i+o WHERE tenant_id=t AND month=mo;
  UPDATE ai_member_months SET reserved_tokens=reserved_tokens+i+o WHERE tenant_id=t AND member_id=m AND month=mo;
 ELSE
  PERFORM ai_record_denial(t,m,f,code,r);
 END IF;
 RETURN NEXT;
END $$;

ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_kind_check, DROP CONSTRAINT member_notifications_goal_shape;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK(kind IN (
 'CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE','POOL_RECLAIMED','PROTECTION_REVIEW','WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100')),
 ADD CONSTRAINT member_notifications_goal_shape CHECK (
 (kind='WORK_GOAL_BEHIND' AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NOT NULL AND goal_date IS NOT NULL AND details IS NOT NULL AND jsonb_typeof(details)='object')
 OR (kind IN ('AI_QUOTA_80','AI_QUOTA_100') AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
 OR (kind NOT IN ('WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100') AND object_id IS NOT NULL AND record_id IS NOT NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
);
CREATE OR REPLACE VIEW public.current_member_notifications WITH (security_invoker=true) AS
 SELECT n.id,n.tenant_id,n.recipient_member_id,n.object_id,n.record_id,n.follow_up_id,n.kind,n.event_key,n.due_at,n.created_at,n.created_xid,n.read_at,n.resolved_at,o.code AS object_code,o.name AS object_name,r.record_no,r.owner_member_id AS record_owner_member_id,n.goal_rule_id,n.goal_date,n.details
 FROM public.member_notifications n
 JOIN public.tenants t ON t.id=n.tenant_id AND t.status='ACTIVE'
 JOIN public.tenant_members m ON m.tenant_id=n.tenant_id AND m.id=n.recipient_member_id AND m.status='ACTIVE'
 JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
 LEFT JOIN public.object_definitions o ON o.tenant_id=n.tenant_id AND o.id=n.object_id
 LEFT JOIN public.records r ON r.tenant_id=n.tenant_id AND r.object_id=n.object_id AND r.id=n.record_id
 LEFT JOIN public.record_follow_ups f ON f.tenant_id=n.tenant_id AND f.record_id=n.record_id AND f.id=n.follow_up_id
 WHERE n.resolved_at IS NULL AND (
  n.kind IN ('WORK_GOAL_BEHIND','POOL_RECLAIMED','AI_QUOTA_80','AI_QUOTA_100') OR (
   o.status='ACTIVE' AND o.deleted_at IS NULL AND r.deleted_at IS NULL AND (
    (n.kind IN ('CONTACT_DUE','FOLLOW_UP_DUE') AND o.pool_enabled AND o.pool_lifecycle_enabled
      AND NOT r.in_public_pool AND r.owner_member_id=n.recipient_member_id
      AND r.ownership_expires_at=n.due_at AND n.due_at>CURRENT_TIMESTAMP
      AND ((n.kind='CONTACT_DUE' AND r.pool_stage='PENDING_CONTACT' AND n.due_at<=CURRENT_TIMESTAMP+LEAST(interval '2 hours',o.pool_contact_ttl_hours*interval '1 hour'/4))
        OR (n.kind='FOLLOW_UP_DUE' AND r.pool_stage='FOLLOWING' AND n.due_at<=CURRENT_TIMESTAMP+LEAST(interval '24 hours',o.pool_follow_up_ttl_hours*interval '1 hour'/4))))
    OR (n.kind='TASK_OVERDUE' AND f.status='OPEN' AND f.assignee_member_id=n.recipient_member_id AND f.due_at=n.due_at AND f.due_at<=CURRENT_TIMESTAMP)
    OR (n.kind='PROTECTION_REVIEW' AND r.pool_stage='PROTECTED' AND r.protection_needs_review AND m.role='TENANT_ADMIN')
   )
  )
 );

CREATE FUNCTION ai_check_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cap numeric; used numeric:=NEW.input_tokens::numeric+NEW.output_tokens; pct integer;
BEGIN
 SELECT p.monthly_tokens::numeric+NEW.extra_tokens INTO cap FROM tenant_ai_configs c JOIN ai_plans p ON p.id=c.plan_id WHERE c.tenant_id=NEW.tenant_id;
 IF cap IS NULL OR cap=0 THEN RETURN NEW; END IF;
 FOREACH pct IN ARRAY ARRAY[80,100] LOOP
  IF used*100>=cap*pct AND NOT (CASE pct WHEN 80 THEN NEW.notified_80 ELSE NEW.notified_100 END) THEN
   INSERT INTO member_notifications(tenant_id,recipient_member_id,kind,event_key)
   SELECT NEW.tenant_id,m.id,'AI_QUOTA_'||pct,NEW.month::text FROM tenant_members m JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=NEW.tenant_id AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'
    ON CONFLICT DO NOTHING;
   IF pct=80 THEN NEW.notified_80:=true; ELSE NEW.notified_100:=true; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Do not run on INSERT: new months have no settled consumption. BEFORE INSERT
-- also runs on the insert branch of an UPSERT before conflicts are resolved.
CREATE TRIGGER ai_month_threshold BEFORE UPDATE OF input_tokens,output_tokens,extra_tokens ON ai_tenant_months
 FOR EACH ROW EXECUTE FUNCTION ai_check_thresholds();
CREATE FUNCTION ai_refresh_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='ai_plans' THEN
  UPDATE ai_tenant_months m SET extra_tokens=m.extra_tokens FROM tenant_ai_configs c JOIN tenants t ON t.id=c.tenant_id
   WHERE c.plan_id=NEW.id AND m.tenant_id=c.tenant_id AND m.month=date_trunc('month',clock_timestamp() AT TIME ZONE t.timezone)::date;
 ELSE
  UPDATE ai_tenant_months m SET extra_tokens=m.extra_tokens FROM tenants t WHERE m.tenant_id=NEW.tenant_id AND t.id=m.tenant_id
    AND m.month=date_trunc('month',clock_timestamp() AT TIME ZONE t.timezone)::date;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_config_change AFTER UPDATE OF plan_id ON tenant_ai_configs FOR EACH ROW EXECUTE FUNCTION ai_refresh_thresholds();
CREATE TRIGGER ai_cap_change AFTER UPDATE OF monthly_tokens ON ai_plans FOR EACH ROW EXECUTE FUNCTION ai_refresh_thresholds();

CREATE FUNCTION ai_project_draft(d ai_record_drafts) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id,request_text,changes,object_id,record_id,created_at,updated_at)
 VALUES(d.id,d.tenant_id,d.member_id,'communication','draft','DRAFT',d.request_id::text,d.text,'{"items":{}}',d.object_id,d.record_id,d.created_at,d.updated_at)
 ON CONFLICT DO NOTHING
$$;
CREATE FUNCTION ai_draft_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM ai_project_draft(NEW); RETURN NEW; END $$;
CREATE TRIGGER ai_draft_created AFTER INSERT ON ai_record_drafts FOR EACH ROW EXECUTE FUNCTION ai_draft_created();

ALTER TABLE ai_operation_records ADD COLUMN first_confirmed_at timestamptz;
CREATE FUNCTION ai_project_operation(op ai_operations,created boolean,historical boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE diff jsonb; obj uuid; rec uuid; tz text; event_time timestamptz;
BEGIN
 -- Preserve only display-level values and field authorization keys.
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('fieldKey',v->>'fieldKey','label',v->>'label',
    'before',v->>'before','after',v->>'after')) ORDER BY ord),'[]') INTO diff
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(op.display_changes_json->'changes')='array' THEN op.display_changes_json->'changes' ELSE '[]' END)
 WITH ORDINALITY a(v,ord) WHERE jsonb_typeof(v)='object';
 IF op.draft_id IS NOT NULL THEN
  UPDATE ai_operation_records SET
   changes=jsonb_set(changes,ARRAY['items',op.draft_item_key],jsonb_build_object('operationId',op.id,'operationType',op.operation_type,'status',op.status,'changes',diff)),
   status=CASE WHEN op.status='EXECUTED' OR status='EXECUTED' THEN 'EXECUTED' ELSE op.status::text END,
   confirmed_by_member_id=coalesce(op.confirmed_by_member_id,confirmed_by_member_id),audit_id=coalesce(op.audit_id,audit_id),updated_at=greatest(op.updated_at,updated_at)
   WHERE tenant_id=op.tenant_id AND id=op.draft_id AND source='draft';
  RETURN;
 END IF;
 SELECT object_id INTO obj FROM object_publications WHERE tenant_id=op.tenant_id AND id=op.expected_publication_id;
 IF (op.target_ref_json->>'recordId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN rec:=(op.target_ref_json->>'recordId')::uuid; END IF;
 INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_text,changes,object_id,record_id,confirmed_by_member_id,audit_id,created_at,updated_at)
 VALUES(op.id,op.tenant_id,op.requested_by_member_id,'write_proposal','proposal',op.status::text,op.request_text,
   jsonb_build_object('operationType',op.operation_type,'changes',diff),obj,rec,op.confirmed_by_member_id,op.audit_id,op.created_at,op.updated_at)
 ON CONFLICT(tenant_id,id) DO UPDATE SET status=excluded.status,changes=excluded.changes,confirmed_by_member_id=excluded.confirmed_by_member_id,
   audit_id=excluded.audit_id,updated_at=excluded.updated_at;
 SELECT timezone INTO STRICT tz FROM tenants WHERE id=op.tenant_id;
 IF created AND NOT historical THEN
  INSERT INTO ai_daily_usage(tenant_id,local_date,feature,proposals) VALUES(op.tenant_id,(op.created_at AT TIME ZONE tz)::date,'write_proposal',1)
  ON CONFLICT(tenant_id,local_date,feature) DO UPDATE SET proposals=ai_daily_usage.proposals+1;
 END IF;
 IF op.status='EXECUTED' THEN
  event_time:=coalesce(op.executed_at,op.confirmed_at,op.updated_at);
  UPDATE ai_operation_records SET first_confirmed_at=event_time WHERE tenant_id=op.tenant_id AND id=op.id AND first_confirmed_at IS NULL;
  IF FOUND AND NOT historical THEN
   INSERT INTO ai_daily_usage(tenant_id,local_date,feature,confirmations) VALUES(op.tenant_id,(event_time AT TIME ZONE tz)::date,'write_proposal',1)
   ON CONFLICT(tenant_id,local_date,feature) DO UPDATE SET confirmations=ai_daily_usage.confirmations+1;
  END IF;
 END IF;
END $$;
CREATE FUNCTION ai_operation_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM ai_project_operation(NEW,TG_OP='INSERT',false); RETURN NEW; END $$;
CREATE TRIGGER ai_operation_changed AFTER INSERT OR UPDATE ON ai_operations FOR EACH ROW EXECUTE FUNCTION ai_operation_changed();
SELECT ai_project_draft(d) FROM ai_record_drafts d;
SELECT ai_project_operation(o,false,true) FROM ai_operations o;

CREATE FUNCTION ai_project_blueprint() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id,object_id,audit_id,confirmed_by_member_id,created_at,updated_at)
 SELECT NEW.id,NEW.tenant_id,m.id,'table_builder','blueprint','EXECUTED',NEW.request_id,NEW.resource_id,NEW.id,m.id,NEW.created_at,NEW.created_at
 FROM tenant_members m WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_project_blueprint AFTER INSERT ON audit_logs FOR EACH ROW
 WHEN (NEW.action='ai.table_blueprint_confirmed' AND NEW.resource_type='object_definition' AND NEW.actor_type='USER') EXECUTE FUNCTION ai_project_blueprint();

-- Hide sibling audit rows from the same AI write transaction as well as the
-- source audit. Owner-specific policies on the source records remain intact.
CREATE INDEX ai_operation_records_request ON ai_operation_records(tenant_id,request_id) WHERE request_id IS NOT NULL;
-- Record only identifiers, so a related automation's generic audit is also
-- hidden regardless of its insertion order inside the source transaction.
INSERT INTO ai_private_audit_requests SELECT DISTINCT tenant_id,request_id FROM audit_logs
 WHERE tenant_id IS NOT NULL AND (resource_type IN ('ai_operation','ai_record_draft') OR action='ai.table_blueprint_confirmed' OR after ? 'aiOperationId');
CREATE FUNCTION ai_tag_audit_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO ai_private_audit_requests VALUES(NEW.tenant_id,NEW.request_id) ON CONFLICT DO NOTHING;
 IF NEW.action='ai.communication_item_failed' AND NEW.resource_type='ai_record_draft' AND NEW.reason IN ('note','followUp','fields') THEN
  UPDATE ai_operation_records SET
   changes=jsonb_set(changes,ARRAY['items',NEW.reason],coalesce(changes->'items'->NEW.reason,jsonb_build_object(
     'operationType',CASE NEW.reason WHEN 'note' THEN 'ADD_ACTIVITY_NOTE' WHEN 'followUp' THEN 'CREATE_FOLLOW_UP' ELSE 'UPDATE_RECORD' END,
     'changes','[]'::jsonb)) || jsonb_build_object('status','FAILED')),
   status=CASE WHEN status='EXECUTED' THEN status ELSE 'FAILED' END,updated_at=NEW.created_at
   WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id AND source='draft'
     AND (changes->'items'->NEW.reason->>'status') IS DISTINCT FROM 'EXECUTED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_tag_audit_request AFTER INSERT ON audit_logs FOR EACH ROW WHEN(
 NEW.tenant_id IS NOT NULL AND (NEW.resource_type IN ('ai_operation','ai_record_draft') OR NEW.action='ai.table_blueprint_confirmed' OR NEW.after ? 'aiOperationId')
) EXECUTE FUNCTION ai_tag_audit_request();
CREATE FUNCTION ai_private_request(t uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT ai_is_platform() AND EXISTS(SELECT FROM ai_private_audit_requests WHERE tenant_id=t AND request_id=r)
$$;
ALTER POLICY audit_logs_platform_admin_select ON audit_logs USING(
 ai_is_platform() AND resource_type NOT IN ('ai_operation','ai_record_draft') AND action<>'ai.table_blueprint_confirmed'
 AND NOT coalesce(after ? 'aiOperationId',false) AND NOT ai_private_request(tenant_id,request_id)
);

-- Explicit allowlist: internal settle/recovery/projection helpers must never
-- become directly callable by the application or PUBLIC.
DO $$ DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
 'ai_is_platform','ai_is_member','ai_configure_tenant','ai_assign_plan','ai_add_quota','ai_anomaly_summary',
 'ai_feature_gate','ai_record_denial','ai_finish_call','ai_recover_expired','ai_recover_platform_expired','ai_settle_call','ai_budget_error','ai_reserve_call',
 'ai_check_thresholds','ai_refresh_thresholds','ai_project_draft','ai_draft_created','ai_project_operation','ai_operation_changed','ai_project_blueprint','ai_tag_audit_request','ai_private_request') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,crm_app',fn.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO crm_ai_writer',fn.signature);
  IF fn.proname IN ('ai_is_platform','ai_is_member','ai_assign_plan','ai_add_quota','ai_anomaly_summary','ai_feature_gate','ai_record_denial','ai_recover_expired','ai_recover_platform_expired','ai_settle_call','ai_reserve_call','ai_private_request') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_app',fn.signature);
  END IF;
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM crm_ai_writer;
COMMIT;
