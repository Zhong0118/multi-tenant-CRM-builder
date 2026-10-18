-- Additive only: historical records remain unclassified and retain ownership.
ALTER TABLE public.object_definitions
 ADD COLUMN pool_lifecycle_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN pool_contact_ttl_hours integer NOT NULL DEFAULT 24 CHECK (pool_contact_ttl_hours BETWEEN 1 AND 8760),
 ADD COLUMN pool_follow_up_ttl_hours integer NOT NULL DEFAULT 720 CHECK (pool_follow_up_ttl_hours BETWEEN 1 AND 8760),
 ADD COLUMN pool_labels jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN pool_protection_rules jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.records
 ADD COLUMN pool_stage varchar(32) CHECK (pool_stage IN ('LEAD_POOL','CUSTOMER_POOL','PENDING_CONTACT','FOLLOWING','PROTECTED')),
 ADD COLUMN pool_origin varchar(32) CHECK (pool_origin IN ('LEAD_POOL','CUSTOMER_POOL')),
 ADD COLUMN pool_claimed_at timestamptz(3),
 ADD COLUMN pool_last_follow_up_at timestamptz(3),
 ADD COLUMN pool_protected_at timestamptz(3),
 ADD COLUMN pool_reason text,
 ADD COLUMN pool_quality varchar(16) CHECK (pool_quality IN ('INVALID','DUPLICATE','LOST')),
 ADD COLUMN protection_needs_review boolean NOT NULL DEFAULT false;
CREATE INDEX records_pool_stage_idx ON public.records(tenant_id,object_id,pool_stage,owner_member_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.keep_record_ownership_consistent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE config record;
BEGIN
 IF NEW.owner_member_id IS NOT NULL THEN NEW.in_public_pool := false; END IF;
 IF NEW.owner_member_id IS NULL THEN
   NEW.ownership_expires_at := NULL;
   IF NEW.pool_stage IN ('PENDING_CONTACT','FOLLOWING') THEN NEW.pool_stage := NULL; END IF;
 ELSIF NEW.owner_member_id IS DISTINCT FROM OLD.owner_member_id THEN
   NEW.ownership_expires_at := NULL;
   -- Every owner-writing path retains protection or starts a fresh contact period.
   IF OLD.pool_stage IS NOT NULL THEN
     SELECT pool_enabled,pool_lifecycle_enabled,pool_contact_ttl_hours INTO config
       FROM public.object_definitions WHERE id=NEW.object_id AND tenant_id=NEW.tenant_id;
     IF OLD.pool_stage='PROTECTED' THEN
       NEW.pool_stage := 'PROTECTED';
     ELSIF config.pool_lifecycle_enabled THEN
       NEW.pool_stage := 'PENDING_CONTACT';
       NEW.pool_origin := CASE WHEN OLD.pool_stage IN ('CUSTOMER_POOL','FOLLOWING') OR OLD.pool_origin='CUSTOMER_POOL' THEN 'CUSTOMER_POOL' ELSE 'LEAD_POOL' END;
       NEW.pool_claimed_at := statement_timestamp();
       NEW.pool_last_follow_up_at := NULL;
       NEW.ownership_expires_at := statement_timestamp() + config.pool_contact_ttl_hours * interval '1 hour';
     END IF;
   END IF;
 END IF;
 IF NEW.pool_stage='PROTECTED' THEN
   IF NEW.owner_member_id IS NULL THEN RAISE EXCEPTION 'Protected records require an owner' USING ERRCODE='23514'; END IF;
   NEW.ownership_expires_at := NULL;
 END IF;
 RETURN NEW;
END;
$function$;

-- A content-bearing member activity is the only automatic lease renewal event.
-- The parent row is locked before testing its current deadline and stage.
CREATE FUNCTION public.renew_record_pool_follow_up() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target record; config record; actor record;
BEGIN
 IF NEW.activity_type NOT IN ('NOTE','CALL','MEETING','MESSAGE') OR length(btrim(COALESCE(NEW.content,'')))=0 THEN RETURN NEW; END IF;
 SELECT * INTO target FROM public.records WHERE id=NEW.record_id AND tenant_id=NEW.tenant_id AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO config FROM public.object_definitions WHERE id=target.object_id AND tenant_id=target.tenant_id;
 IF NOT config.pool_enabled OR NOT config.pool_lifecycle_enabled OR target.pool_stage IS DISTINCT FROM 'FOLLOWING' THEN RETURN NEW; END IF;
 SELECT m.role INTO actor FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id
 WHERE m.id=NEW.actor_member_id AND m.tenant_id=NEW.tenant_id AND m.status='ACTIVE' AND u.status='ACTIVE' AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid;
 IF NOT FOUND OR (actor.role<>'TENANT_ADMIN' AND NEW.actor_member_id IS DISTINCT FROM target.owner_member_id) THEN RETURN NEW; END IF;
 IF target.ownership_expires_at IS NULL OR target.ownership_expires_at <= statement_timestamp() THEN
   RAISE EXCEPTION 'Record follow-up deadline expired' USING ERRCODE='P0001';
 END IF;
 UPDATE public.records SET pool_last_follow_up_at=statement_timestamp(), ownership_expires_at=statement_timestamp()+config.pool_follow_up_ttl_hours*interval '1 hour', version=version+1,updated_at=statement_timestamp() WHERE id=target.id;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER records_pool_follow_up AFTER INSERT ON public.record_activities FOR EACH ROW EXECUTE FUNCTION public.renew_record_pool_follow_up();

GRANT UPDATE (pool_stage,pool_origin,pool_reason) ON public.records TO crm_pool_reclaimer;
CREATE OR REPLACE FUNCTION public.reclaim_expired_record_ownership(batch_size integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE object_row record; record_row record; reclaimed integer:=0; bounded_size integer:=LEAST(GREATEST(COALESCE(batch_size,100),1),100);
BEGIN
 FOR object_row IN SELECT o.id,o.tenant_id,o.pool_lifecycle_enabled FROM public.object_definitions o
 WHERE o.pool_enabled AND o.status='ACTIVE' AND o.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=o.tenant_id AND t.status='ACTIVE')
 AND EXISTS(SELECT 1 FROM public.records r WHERE r.object_id=o.id AND r.tenant_id=o.tenant_id AND r.deleted_at IS NULL AND NOT r.in_public_pool AND r.owner_member_id IS NOT NULL AND r.ownership_expires_at<=CURRENT_TIMESTAMP AND r.pool_stage IS DISTINCT FROM 'PROTECTED')
 ORDER BY o.id LIMIT 100 FOR SHARE OF o SKIP LOCKED
 LOOP
  FOR record_row IN SELECT r.* FROM public.records r WHERE r.tenant_id=object_row.tenant_id AND r.object_id=object_row.id AND r.deleted_at IS NULL AND NOT r.in_public_pool AND r.owner_member_id IS NOT NULL AND r.ownership_expires_at<=CURRENT_TIMESTAMP AND r.pool_stage IS DISTINCT FROM 'PROTECTED'
  ORDER BY r.ownership_expires_at,r.id LIMIT (bounded_size-reclaimed) FOR UPDATE SKIP LOCKED
  LOOP
   UPDATE public.records SET owner_member_id=NULL,in_public_pool=true,ownership_expires_at=NULL,
     pool_stage=CASE WHEN object_row.pool_lifecycle_enabled AND record_row.pool_stage IS NOT NULL THEN CASE WHEN record_row.pool_stage='PENDING_CONTACT' THEN COALESCE(record_row.pool_origin,'LEAD_POOL') ELSE 'CUSTOMER_POOL' END ELSE record_row.pool_stage END,
     pool_reason=CASE WHEN record_row.pool_stage='PENDING_CONTACT' THEN '联系期限已到，退回来源公共池' WHEN record_row.pool_stage='FOLLOWING' THEN '长期未跟进，自动回收到客户公海' ELSE record_row.pool_reason END,
     version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=record_row.id AND version=record_row.version AND pool_stage IS DISTINCT FROM 'PROTECTED';
   IF FOUND THEN
    INSERT INTO public.audit_logs(tenant_id,actor_type,action,resource_type,resource_id,"before","after",request_id)
    VALUES(object_row.tenant_id,'SYSTEM','record.ownership_reclaimed','record',record_row.id,jsonb_build_object('ownerMemberId',record_row.owner_member_id,'poolStage',record_row.pool_stage,'version',record_row.version),jsonb_build_object('ownerMemberId',NULL,'inPublicPool',true,'version',record_row.version+1),'record-pool-sweep');
    reclaimed:=reclaimed+1;
   END IF;
  END LOOP;
  EXIT WHEN reclaimed>=bounded_size;
 END LOOP;
 RETURN reclaimed;
END;
$function$;
