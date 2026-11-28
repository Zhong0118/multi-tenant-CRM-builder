-- Platform outbound calling (快马 callback). The platform holds one supplier
-- account for every company and resells minutes in plans, the way it sells AI
-- (0054). Secrets are AES-GCM envelopes sealed by the API keyring; the database
-- never sees plaintext. Billing, monthly usage and threshold notices are kept by
-- triggers owned by a non-login writer role, so the application cannot write
-- them directly.
BEGIN;

DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='crm_telephony_writer') THEN
  CREATE ROLE crm_telephony_writer NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE, CREATE ON SCHEMA public TO crm_telephony_writer;

CREATE TABLE telephony_platform_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 mode varchar(16) NOT NULL DEFAULT 'MOCK' CHECK (mode IN ('MOCK','KUAIMA')),
 company_id varchar(100) NOT NULL DEFAULT '',
 app_secret_encrypted text,
 callback_token_encrypted text,
 cost_per_minute numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_per_minute >= 0),
 seat_monthly_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (seat_monthly_cost >= 0),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO telephony_platform_settings DEFAULT VALUES;

CREATE TABLE telephony_plans (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 name varchar(60) NOT NULL UNIQUE CHECK (btrim(name) <> ''),
 seats integer NOT NULL CHECK (seats BETWEEN 1 AND 10000),
 monthly_minutes integer NOT NULL CHECK (monthly_minutes BETWEEN 0 AND 10000000),
 monthly_price numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
 assignable boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- No row means 未开通. Rows are written only by telephony_assign_plan.
CREATE TABLE tenant_telephony_configs (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 plan_id uuid REFERENCES telephony_plans(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX tenant_telephony_configs_plan_id_idx ON tenant_telephony_configs(plan_id);
-- Append-only. Revenue for a month uses the last row before that month ends.
CREATE TABLE telephony_plan_history (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 plan_id uuid,
 plan_name varchar(60),
 monthly_price numeric(12,2) NOT NULL DEFAULT 0,
 monthly_minutes integer NOT NULL DEFAULT 0,
 seats integer NOT NULL DEFAULT 0,
 effective_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX telephony_plan_history_tenant_id_effective_at_idx ON telephony_plan_history(tenant_id, effective_at DESC);
CREATE TABLE telephony_tenant_months (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 used_minutes integer NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
 extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0),
 notified_80 boolean NOT NULL DEFAULT false,
 notified_100 boolean NOT NULL DEFAULT false,
 PRIMARY KEY (tenant_id, month)
);
CREATE TABLE telephony_minute_additions (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 key varchar(100) NOT NULL,
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1000000),
 price numeric(12,2) NOT NULL CHECK (price >= 0),
 note varchar(200) NOT NULL DEFAULT '',
 created_by uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id, key)
);
CREATE INDEX telephony_minute_additions_tenant_id_month_idx ON telephony_minute_additions(tenant_id, month);

CREATE TABLE telephony_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 phone_fields jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phone_fields) = 'array'),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE telephony_member_bindings (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 member_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 enabled boolean NOT NULL DEFAULT false,
 -- Written by the system after the supplier created the seat; MOCK-… on the simulated line.
 seat_id varchar(100) NOT NULL DEFAULT '',
 provider_username varchar(64) NOT NULL DEFAULT '',
 seat_created_at timestamptz(3),
 seat_error varchar(200),
 phone varchar(20) NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^1[3-9][0-9]{9}$'),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,member_id),
 FOREIGN KEY (tenant_id,member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE telephony_calls (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 actor_member_id uuid NOT NULL,
 request_id uuid NOT NULL,
 object_id uuid NOT NULL,
 object_code varchar(64) NOT NULL,
 record_id uuid NOT NULL,
 field_key varchar(64) NOT NULL,
 mode varchar(16) NOT NULL CHECK (mode IN ('MOCK','KUAIMA')),
 status varchar(32) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','ACCEPTED','UNKNOWN','CONNECTED','NOT_CONNECTED','ENDED','FAILED')),
 caller_phone varchar(20) NOT NULL CHECK (caller_phone ~ '^1[3-9][0-9]{9}$'),
 callee_phone varchar(20) NOT NULL CHECK (callee_phone ~ '^1[3-9][0-9]{9}$'),
 seat_id varchar(100) NOT NULL,
 provider_bind_id varchar(200),
 -- The supplier's short refusal text when it rejected the dial.
 failure_reason varchar(200),
 recording_url text,
 began_at timestamptz(3),
 ended_at timestamptz(3),
 duration_seconds integer CHECK (duration_seconds >= 0),
 activity_id uuid,
 -- Stamped by telephony_call_stamp: the company's month at dial time, the
 -- platform's cost per minute at dial time, and the minutes billed once connected.
 month date NOT NULL DEFAULT CURRENT_DATE,
 billed_minutes integer NOT NULL DEFAULT 0 CHECK (billed_minutes >= 0),
 cost_per_minute numeric(10,4) NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (tenant_id,actor_member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,object_id,record_id) REFERENCES records(tenant_id,object_id,id) ON DELETE RESTRICT,
 -- An administrator may delete the machine CALL activity (0048); the call keeps its outcome.
 FOREIGN KEY (tenant_id,record_id,activity_id) REFERENCES record_activities(tenant_id,record_id,id) ON DELETE SET NULL (activity_id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE (tenant_id,actor_member_id,request_id),
 -- One supplier account for the whole platform: a supplier call ID names one call.
 UNIQUE (provider_bind_id)
);
-- UNKNOWN deliberately holds the gate until a verified callback resolves it.
CREATE UNIQUE INDEX telephony_calls_one_open_per_actor ON telephony_calls(tenant_id,actor_member_id)
 WHERE status IN ('REQUESTED','ACCEPTED','UNKNOWN');
CREATE INDEX telephony_calls_tenant_id_actor_member_id_created_at_idx ON telephony_calls(tenant_id,actor_member_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_record_id_created_at_idx ON telephony_calls(tenant_id,record_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_created_at_idx ON telephony_calls(tenant_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_month_idx ON telephony_calls(tenant_id,month);

DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['telephony_platform_settings','telephony_plans','tenant_telephony_configs','telephony_plan_history','telephony_tenant_months','telephony_minute_additions','telephony_settings','telephony_member_bindings','telephony_calls'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY telephony_writer_access ON %I TO crm_telephony_writer USING(true) WITH CHECK(true)',n);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO crm_telephony_writer',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['telephony_settings','telephony_member_bindings','telephony_calls'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app',n);
  EXECUTE format('CREATE POLICY %I ON %I TO crm_app USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',n || '_tenant_access',n);
 END LOOP;
END $$;
GRANT SELECT, UPDATE ON telephony_platform_settings TO crm_app;
CREATE POLICY platform_line ON telephony_platform_settings TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
GRANT SELECT, INSERT, UPDATE, DELETE ON telephony_plans TO crm_app;
CREATE POLICY platform_plans ON telephony_plans TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
GRANT SELECT ON tenant_telephony_configs, telephony_plan_history, telephony_tenant_months, telephony_minute_additions TO crm_app;
CREATE POLICY config_read ON tenant_telephony_configs FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY month_read ON telephony_tenant_months FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY history_read ON telephony_plan_history FOR SELECT TO crm_app USING(ai_is_platform());
CREATE POLICY additions_read ON telephony_minute_additions FOR SELECT TO crm_app USING(ai_is_platform());
CREATE POLICY telephony_platform_audit ON audit_logs FOR INSERT TO crm_app WITH CHECK(ai_is_platform() AND actor_id=nullif(current_setting('app.user_id',true),'')::uuid AND action IN ('telephony.plan_assigned','telephony.minutes_added'));

GRANT SELECT ON users, tenants, tenant_members TO crm_telephony_writer;
CREATE POLICY telephony_writer_tenants ON tenants FOR SELECT TO crm_telephony_writer USING(true);
CREATE POLICY telephony_writer_members ON tenant_members FOR SELECT TO crm_telephony_writer USING(true);
GRANT INSERT ON member_notifications TO crm_telephony_writer;
CREATE POLICY telephony_writer_thresholds ON member_notifications FOR INSERT TO crm_telephony_writer WITH CHECK(kind IN ('TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100'));
GRANT EXECUTE ON FUNCTION ai_is_platform(), ai_is_member(uuid,uuid,boolean) TO crm_telephony_writer;

ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_kind_check, DROP CONSTRAINT member_notifications_goal_shape;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK(kind IN (
 'CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE','POOL_RECLAIMED','PROTECTION_REVIEW','WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100')),
 ADD CONSTRAINT member_notifications_goal_shape CHECK (
 (kind='WORK_GOAL_BEHIND' AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NOT NULL AND goal_date IS NOT NULL AND details IS NOT NULL AND jsonb_typeof(details)='object')
 OR (kind IN ('AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
 OR (kind NOT IN ('WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') AND object_id IS NOT NULL AND record_id IS NOT NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
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
  n.kind IN ('WORK_GOAL_BEHIND','POOL_RECLAIMED','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') OR (
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

-- Same lock as the API's `${tenantId}:telephony` advisory key.
CREATE FUNCTION telephony_lock_tenant(t uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT pg_advisory_xact_lock(hashtextextended(t::text||':telephony',0))
$$;
CREATE FUNCTION telephony_current_month(t uuid) RETURNS date LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT date_trunc('month', clock_timestamp() AT TIME ZONE timezone)::date FROM tenants WHERE id=t
$$;
CREATE FUNCTION telephony_seats_enabled(t uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*)::int FROM telephony_member_bindings b
 JOIN tenant_members m ON m.tenant_id=b.tenant_id AND m.id=b.member_id
 WHERE b.tenant_id=t AND b.enabled AND m.status='ACTIVE'
$$;
CREATE FUNCTION telephony_usage(t uuid) RETURNS TABLE(month date, plan_id uuid, plan_name text, seats integer, monthly_minutes integer, used_minutes integer, extra_minutes integer, seats_enabled integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT (ai_is_platform() OR coalesce(ai_is_member(t),false)) THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY
 SELECT mo.m, p.id, p.name::text, coalesce(p.seats,0), coalesce(p.monthly_minutes,0),
  coalesce(tm.used_minutes,0), coalesce(tm.extra_minutes,0), telephony_seats_enabled(t)
 FROM (SELECT telephony_current_month(t) AS m) mo
 LEFT JOIN tenant_telephony_configs c ON c.tenant_id=t
 LEFT JOIN telephony_plans p ON p.id=c.plan_id
 LEFT JOIN telephony_tenant_months tm ON tm.tenant_id=t AND tm.month=mo.m;
END $$;
-- Dialing needs the line in every company context; the envelopes stay sealed.
CREATE FUNCTION telephony_line() RETURNS TABLE(mode text, company_id text, app_secret_encrypted text, callback_token_encrypted text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.mode::text, s.company_id::text, s.app_secret_encrypted, s.callback_token_encrypted FROM telephony_platform_settings s WHERE s.id
$$;
-- One callback address for every company: the supplier call ID names the company.
CREATE FUNCTION telephony_route_bind(b text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT c.tenant_id FROM telephony_calls c WHERE c.provider_bind_id=b
$$;
CREATE FUNCTION telephony_record_plan(t uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 INSERT INTO telephony_plan_history(tenant_id,plan_id,plan_name,monthly_price,monthly_minutes,seats)
 SELECT t, p.id, p.name, coalesce(p.monthly_price,0), coalesce(p.monthly_minutes,0), coalesce(p.seats,0)
 FROM tenant_telephony_configs c LEFT JOIN telephony_plans p ON p.id=c.plan_id WHERE c.tenant_id=t
$$;
CREATE FUNCTION telephony_assign_plan(t uuid, p uuid, v integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cur tenant_telephony_configs%ROWTYPE; target telephony_plans%ROWTYPE;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 PERFORM telephony_lock_tenant(t);
 IF NOT EXISTS (SELECT FROM tenants WHERE id=t) THEN RAISE invalid_parameter_value; END IF;
 SELECT * INTO cur FROM tenant_telephony_configs WHERE tenant_id=t;
 IF coalesce(cur.version,0)<>v THEN RETURN false; END IF;
 IF cur.plan_id IS NOT DISTINCT FROM p THEN RETURN true; END IF;
 IF p IS NOT NULL THEN
  SELECT * INTO target FROM telephony_plans WHERE id=p FOR SHARE;
  IF NOT FOUND OR NOT target.assignable THEN RAISE invalid_parameter_value; END IF;
  IF telephony_seats_enabled(t)>target.seats THEN
   RAISE EXCEPTION 'TELEPHONY_SEATS_EXCEEDED' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO tenant_telephony_configs AS c (tenant_id,plan_id) VALUES(t,p)
  ON CONFLICT (tenant_id) DO UPDATE SET plan_id=excluded.plan_id, version=c.version+1;
 PERFORM telephony_record_plan(t);
 RETURN true;
END $$;
CREATE FUNCTION telephony_add_minutes(t uuid, mo date, n integer, amount numeric, memo text, k text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old telephony_minute_additions%ROWTYPE;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 PERFORM telephony_lock_tenant(t);
 SELECT * INTO old FROM telephony_minute_additions WHERE tenant_id=t AND key=k;
 IF FOUND THEN
  IF old.minutes<>n OR old.month<>mo OR old.price<>amount THEN RAISE invalid_parameter_value; END IF;
  RETURN false;
 END IF;
 IF mo IS DISTINCT FROM telephony_current_month(t) THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO telephony_minute_additions(tenant_id,key,month,minutes,price,note,created_by)
  VALUES(t,k,mo,n,amount,coalesce(memo,''),nullif(current_setting('app.user_id',true),'')::uuid);
 INSERT INTO telephony_tenant_months(tenant_id,month) VALUES(t,mo) ON CONFLICT DO NOTHING;
 UPDATE telephony_tenant_months SET extra_minutes=extra_minutes+n WHERE tenant_id=t AND month=mo;
 RETURN true;
END $$;
CREATE FUNCTION telephony_plan_overflow(p uuid, new_seats integer) RETURNS TABLE(tenant_id uuid, tenant_name text, seats_enabled integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY
 SELECT c.tenant_id, tn.name::text, telephony_seats_enabled(c.tenant_id)
 FROM tenant_telephony_configs c JOIN tenants tn ON tn.id=c.tenant_id
 WHERE c.plan_id=p AND telephony_seats_enabled(c.tenant_id)>new_seats
 ORDER BY tn.name, c.tenant_id;
END $$;
CREATE FUNCTION telephony_report(mo date) RETURNS TABLE(tenant_id uuid, tenant_name text, plan_name text, monthly_price numeric, monthly_minutes integer, used_minutes integer, extra_minutes integer, extra_price numeric, minute_cost numeric, seats_provisioned integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 IF extract(day FROM mo)<>1 THEN RAISE invalid_parameter_value; END IF;
 RETURN QUERY
 WITH bounds AS (
  SELECT tn.id, tn.name, ((mo + interval '1 month')::timestamp AT TIME ZONE tn.timezone) AS ends FROM tenants tn
 ), plan AS (
  SELECT DISTINCT ON (h.tenant_id) h.tenant_id, h.plan_id, h.plan_name, h.monthly_price, h.monthly_minutes
  FROM telephony_plan_history h JOIN bounds b ON b.id=h.tenant_id
  WHERE h.effective_at < b.ends
  ORDER BY h.tenant_id, h.effective_at DESC, h.id DESC
 ), billed AS (
  SELECT c.tenant_id, sum(c.billed_minutes)::int AS minutes, sum(c.billed_minutes*c.cost_per_minute) AS cost
  FROM telephony_calls c WHERE c.month=mo GROUP BY c.tenant_id
 ), added AS (
  SELECT a.tenant_id, sum(a.minutes)::int AS minutes, sum(a.price) AS price
  FROM telephony_minute_additions a WHERE a.month=mo GROUP BY a.tenant_id
 ), provisioned AS (
  SELECT s.tenant_id, count(*)::int AS n FROM telephony_member_bindings s JOIN bounds b ON b.id=s.tenant_id
  WHERE s.seat_created_at < b.ends AND s.seat_id <> '' AND s.seat_id NOT LIKE 'MOCK-%' GROUP BY s.tenant_id
 )
 SELECT b.id, b.name::text, p.plan_name::text, coalesce(p.monthly_price,0)::numeric, coalesce(p.monthly_minutes,0),
  coalesce(bl.minutes,0), coalesce(ad.minutes,0), coalesce(ad.price,0)::numeric, coalesce(bl.cost,0)::numeric, coalesce(pv.n,0)
 FROM bounds b
 LEFT JOIN plan p ON p.tenant_id=b.id
 LEFT JOIN billed bl ON bl.tenant_id=b.id
 LEFT JOIN added ad ON ad.tenant_id=b.id
 LEFT JOIN provisioned pv ON pv.tenant_id=b.id
 WHERE p.plan_id IS NOT NULL OR bl.tenant_id IS NOT NULL OR ad.tenant_id IS NOT NULL OR pv.tenant_id IS NOT NULL
 ORDER BY b.name, b.id;
END $$;
CREATE FUNCTION telephony_platform_seats() RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN (SELECT count(*)::int FROM telephony_member_bindings WHERE seat_id<>'' AND seat_id NOT LIKE 'MOCK-%');
END $$;

-- The month, cost and billed minutes are the database's, never the caller's.
CREATE FUNCTION telephony_call_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.month := telephony_current_month(NEW.tenant_id);
  NEW.cost_per_minute := CASE WHEN NEW.mode='KUAIMA' THEN (SELECT s.cost_per_minute FROM telephony_platform_settings s WHERE s.id) ELSE 0 END;
  NEW.billed_minutes := 0;
 ELSE
  NEW.month := OLD.month;
  NEW.cost_per_minute := OLD.cost_per_minute;
  NEW.billed_minutes := OLD.billed_minutes;
 END IF;
 -- Billed once, on the first transition to CONNECTED; whole minutes rounded up.
 IF NEW.status='CONNECTED' AND (TG_OP='INSERT' OR OLD.status<>'CONNECTED') THEN
  NEW.billed_minutes := ceil(coalesce(NEW.duration_seconds,0)/60.0)::int;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER telephony_call_stamp BEFORE INSERT OR UPDATE ON telephony_calls FOR EACH ROW EXECUTE FUNCTION telephony_call_stamp();
CREATE FUNCTION telephony_call_meter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE delta integer := NEW.billed_minutes - CASE WHEN TG_OP='UPDATE' THEN OLD.billed_minutes ELSE 0 END;
BEGIN
 INSERT INTO telephony_tenant_months(tenant_id,month) VALUES(NEW.tenant_id,NEW.month) ON CONFLICT DO NOTHING;
 UPDATE telephony_tenant_months SET used_minutes=used_minutes+delta WHERE tenant_id=NEW.tenant_id AND month=NEW.month;
 RETURN NULL;
END $$;
CREATE TRIGGER telephony_call_meter_insert AFTER INSERT ON telephony_calls FOR EACH ROW WHEN (NEW.billed_minutes > 0) EXECUTE FUNCTION telephony_call_meter();
CREATE TRIGGER telephony_call_meter_update AFTER UPDATE ON telephony_calls FOR EACH ROW WHEN (NEW.billed_minutes > OLD.billed_minutes) EXECUTE FUNCTION telephony_call_meter();
CREATE FUNCTION telephony_check_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cap numeric; pct integer;
BEGIN
 -- A flag, once set for the month, stays set: added minutes never re-notify.
 NEW.notified_80 := NEW.notified_80 OR OLD.notified_80;
 NEW.notified_100 := NEW.notified_100 OR OLD.notified_100;
 SELECT p.monthly_minutes::numeric+NEW.extra_minutes INTO cap FROM tenant_telephony_configs c JOIN telephony_plans p ON p.id=c.plan_id WHERE c.tenant_id=NEW.tenant_id;
 IF cap IS NULL OR cap=0 THEN RETURN NEW; END IF;
 FOREACH pct IN ARRAY ARRAY[80,100] LOOP
  IF NEW.used_minutes::numeric*100>=cap*pct AND NOT (CASE pct WHEN 80 THEN NEW.notified_80 ELSE NEW.notified_100 END) THEN
   INSERT INTO member_notifications(tenant_id,recipient_member_id,kind,event_key)
   SELECT NEW.tenant_id,m.id,'TELEPHONY_MINUTES_'||pct,NEW.month::text FROM tenant_members m JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=NEW.tenant_id AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'
    ON CONFLICT DO NOTHING;
   IF pct=80 THEN NEW.notified_80:=true; ELSE NEW.notified_100:=true; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Not on INSERT: a new month row carries no usage yet.
CREATE TRIGGER telephony_month_threshold BEFORE UPDATE OF used_minutes,extra_minutes ON telephony_tenant_months FOR EACH ROW EXECUTE FUNCTION telephony_check_thresholds();
-- A plan edit applies to every company on it at once, is recorded for revenue,
-- and may not take seats away from a company that already uses them.
CREATE FUNCTION telephony_plan_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t uuid;
BEGIN
 FOR t IN SELECT c.tenant_id FROM tenant_telephony_configs c WHERE c.plan_id=NEW.id ORDER BY c.tenant_id LOOP
  PERFORM telephony_lock_tenant(t);
  IF NEW.seats<OLD.seats AND telephony_seats_enabled(t)>NEW.seats THEN
   RAISE EXCEPTION 'TELEPHONY_SEATS_EXCEEDED' USING ERRCODE='23514';
  END IF;
  IF (NEW.name,NEW.seats,NEW.monthly_minutes,NEW.monthly_price) IS DISTINCT FROM (OLD.name,OLD.seats,OLD.monthly_minutes,OLD.monthly_price) THEN
   PERFORM telephony_record_plan(t);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER telephony_plan_changed AFTER UPDATE ON telephony_plans FOR EACH ROW EXECUTE FUNCTION telephony_plan_changed();

-- Explicit allowlist: internal helpers and triggers are never callable directly.
DO $$ DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature, p.proname FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
  'telephony_lock_tenant','telephony_current_month','telephony_seats_enabled','telephony_usage','telephony_line','telephony_route_bind',
  'telephony_record_plan','telephony_assign_plan','telephony_add_minutes','telephony_plan_overflow','telephony_report','telephony_platform_seats',
  'telephony_call_stamp','telephony_call_meter','telephony_check_thresholds','telephony_plan_changed') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,crm_app',fn.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO crm_telephony_writer',fn.signature);
  IF fn.proname IN ('telephony_usage','telephony_line','telephony_route_bind','telephony_assign_plan','telephony_add_minutes','telephony_plan_overflow','telephony_report','telephony_platform_seats') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_app',fn.signature);
  END IF;
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM crm_telephony_writer;

-- Same body as 0030 plus the first check: a machine call outcome counts as a
-- call, never as a human follow-up, so it does not renew the pool deadline.
CREATE OR REPLACE FUNCTION public.renew_record_pool_follow_up() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target record; config record; actor record; event_time timestamptz;
BEGIN
 IF EXISTS (SELECT 1 FROM public.telephony_calls c WHERE c.tenant_id=NEW.tenant_id AND c.record_id=NEW.record_id AND c.actor_member_id=NEW.actor_member_id AND c.activity_id=NEW.id AND c.mode='KUAIMA' AND c.status IN ('CONNECTED','NOT_CONNECTED')) THEN RETURN NEW; END IF;
 IF NEW.activity_type NOT IN ('NOTE','CALL','MEETING','MESSAGE') OR length(btrim(COALESCE(NEW.content,'')))=0 THEN RETURN NEW; END IF;
 SELECT * INTO target FROM public.records WHERE id=NEW.record_id AND tenant_id=NEW.tenant_id AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO config FROM public.object_definitions WHERE id=target.object_id AND tenant_id=target.tenant_id;
 IF NOT config.pool_enabled OR NOT config.pool_lifecycle_enabled OR target.pool_stage IS DISTINCT FROM 'FOLLOWING' THEN RETURN NEW; END IF;
 SELECT m.role INTO actor FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id
 WHERE m.id=NEW.actor_member_id AND m.tenant_id=NEW.tenant_id AND m.status='ACTIVE' AND u.status='ACTIVE' AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid;
 IF NOT FOUND OR (actor.role<>'TENANT_ADMIN' AND NEW.actor_member_id IS DISTINCT FROM target.owner_member_id) THEN RETURN NEW; END IF;
 event_time := clock_timestamp();
 IF target.ownership_expires_at IS NULL OR target.ownership_expires_at <= event_time THEN
   RAISE EXCEPTION 'Record follow-up deadline expired' USING ERRCODE='P0001';
 END IF;
 UPDATE public.records SET pool_last_follow_up_at=event_time, ownership_expires_at=event_time+config.pool_follow_up_ttl_hours*interval '1 hour', version=version+1,updated_at=event_time WHERE id=target.id;
 RETURN NEW;
END;
$function$;

COMMIT;
