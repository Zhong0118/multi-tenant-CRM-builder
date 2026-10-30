-- Additive only. Tenant composite FKs prevent cross-tenant associations.
CREATE TABLE telephony_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 enabled boolean NOT NULL DEFAULT false,
 mode varchar(16) NOT NULL DEFAULT 'MOCK' CHECK (mode IN ('MOCK','KUAIMA')),
 company_id varchar(100) NOT NULL DEFAULT '',
 app_secret_encrypted text,
 callback_token_encrypted text,
 phone_fields jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phone_fields) = 'array'),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE telephony_member_bindings (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 member_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 enabled boolean NOT NULL DEFAULT false,
 seat_id varchar(100) NOT NULL DEFAULT '',
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
 recording_url text,
 began_at timestamptz(3),
 ended_at timestamptz(3),
 duration_seconds integer CHECK (duration_seconds >= 0),
 activity_id uuid,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (tenant_id,actor_member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,object_id,record_id) REFERENCES records(tenant_id,object_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,record_id,activity_id) REFERENCES record_activities(tenant_id,record_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 UNIQUE (tenant_id,actor_member_id,request_id),
 UNIQUE (tenant_id,provider_bind_id)
);
-- UNKNOWN deliberately holds the gate until a verified final callback resolves it.
CREATE UNIQUE INDEX telephony_calls_one_open_per_actor ON telephony_calls(tenant_id,actor_member_id)
 WHERE status IN ('REQUESTED','ACCEPTED','UNKNOWN');
CREATE INDEX telephony_calls_tenant_id_actor_member_id_created_at_idx ON telephony_calls(tenant_id,actor_member_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_record_id_created_at_idx ON telephony_calls(tenant_id,record_id,created_at DESC);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['telephony_settings','telephony_member_bindings','telephony_calls'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app',tbl);
  EXECUTE format('CREATE POLICY %I ON %I TO crm_app USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',tbl || '_tenant_access',tbl);
 END LOOP;
END $$;

-- Evaluate expiry using the actual time after waiting for the record lock.
-- statement_timestamp/current_timestamp may predate that wait by seconds.
CREATE OR REPLACE FUNCTION public.renew_record_pool_follow_up() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target record; config record; actor record; event_time timestamptz;
BEGIN
 -- Machine outcomes count as calls, never as a human follow-up or pool renewal.
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

