-- Evaluate expiry using the actual time after waiting for the record lock.
-- statement_timestamp/current_timestamp may predate that wait by seconds.
CREATE OR REPLACE FUNCTION public.renew_record_pool_follow_up() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target record; config record; actor record; event_time timestamptz;
BEGIN
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

CREATE OR REPLACE FUNCTION public.refresh_record_pool_protection(target_tenant uuid, target_id uuid, allow_new boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target public.records; valid_evidence boolean; lifecycle boolean; next_review boolean; event_time timestamptz;
BEGIN
  -- The target lock precedes the evidence read. Concurrent independent source
  -- invalidations therefore see committed evidence after waiting for this row.
  SELECT r.* INTO target FROM public.records r WHERE r.tenant_id=target_tenant AND r.id=target_id AND r.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  event_time := clock_timestamp();
  SELECT o.pool_enabled AND o.pool_lifecycle_enabled AND o.status='ACTIVE' AND o.deleted_at IS NULL INTO lifecycle FROM public.object_definitions o WHERE o.tenant_id=target_tenant AND o.id=target.object_id;
  IF NOT COALESCE(lifecycle,false) AND target.pool_stage IS DISTINCT FROM 'PROTECTED' THEN RETURN; END IF;
  valid_evidence := COALESCE(lifecycle,false) AND public.record_pool_has_evidence(target_tenant,target_id);
  IF target.pool_stage='PROTECTED' THEN
    next_review := NOT valid_evidence;
    IF target.protection_needs_review=next_review THEN RETURN; END IF;
    UPDATE public.records SET protection_needs_review=next_review,version=version+1,updated_at=event_time WHERE tenant_id=target_tenant AND id=target_id;
  ELSIF valid_evidence AND allow_new THEN
    IF NOT public.record_pool_can_protect(target) THEN RAISE EXCEPTION 'POOL_PROTECTION_FORBIDDEN' USING ERRCODE='P0001'; END IF;
    IF target.owner_member_id IS NULL OR target.in_public_pool THEN RAISE EXCEPTION 'POOL_PROTECTION_OWNER_REQUIRED' USING ERRCODE='P0001'; END IF;
    IF target.pool_stage IN ('PENDING_CONTACT','FOLLOWING') AND target.ownership_expires_at <= event_time THEN
      RAISE EXCEPTION 'POOL_PROTECTION_EXPIRED' USING ERRCODE='P0001';
    END IF;
    UPDATE public.records SET pool_stage='PROTECTED',pool_protected_at=event_time,ownership_expires_at=NULL,protection_needs_review=false,version=version+1,updated_at=event_time WHERE tenant_id=target_tenant AND id=target_id;
  ELSE RETURN;
  END IF;
  INSERT INTO public.audit_logs(tenant_id,actor_type,actor_id,action,resource_type,resource_id,"before","after",request_id)
  VALUES(target_tenant,'USER',NULLIF(current_setting('app.user_id',true),'')::uuid,'record.pool_protection_changed','record',target_id,
    jsonb_build_object('poolStage',target.pool_stage,'protectionNeedsReview',target.protection_needs_review),
    jsonb_build_object('poolStage','PROTECTED','protectionNeedsReview',NOT valid_evidence,
      'evidenceRecordIds',(SELECT COALESCE(jsonb_agg(CASE WHEN l.source_record_id=target_id THEN l.target_record_id ELSE l.source_record_id END),'[]'::jsonb) FROM public.record_relations l WHERE l.tenant_id=target_tenant AND (l.source_record_id=target_id OR l.target_record_id=target_id))),
    'record-pool-protection');
END;
$function$;

