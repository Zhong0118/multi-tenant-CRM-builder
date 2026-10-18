-- Serialize protection against target rules and related source publications.
-- Keep the existing object-before-record lock order used by config and ownership.
CREATE FUNCTION public.lock_record_pool_objects(target_tenant uuid, target_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  PERFORM 1 FROM public.object_definitions o
  WHERE o.tenant_id=target_tenant AND o.id IN (
    SELECT r.object_id FROM public.records r WHERE r.tenant_id=target_tenant AND (
      r.id=target_id OR r.id IN (
        SELECT CASE WHEN l.source_record_id=target_id THEN l.target_record_id ELSE l.source_record_id END
        FROM public.record_relations l WHERE l.tenant_id=target_tenant AND (l.source_record_id=target_id OR l.target_record_id=target_id)
      )
    )
  ) ORDER BY o.id FOR SHARE OF o;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_record_pool_objects(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_record_pool_objects(uuid,uuid) TO crm_app;

CREATE OR REPLACE FUNCTION public.refresh_record_pool_protection(target_tenant uuid, target_id uuid, allow_new boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target public.records; valid_evidence boolean; lifecycle boolean; next_review boolean; event_time timestamptz;
BEGIN
  -- The target lock precedes the evidence read. Concurrent independent source
  -- invalidations therefore see committed evidence after waiting for this row.
  PERFORM public.lock_record_pool_objects(target_tenant,target_id);
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


CREATE OR REPLACE FUNCTION public.sync_related_record_pool_protection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid; source_record public.records; allow_new boolean;
BEGIN
  IF TG_TABLE_NAME='records' THEN
    IF NEW.status_key IS NOT DISTINCT FROM OLD.status_key AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
    FOR target_id IN SELECT CASE WHEN l.source_record_id=NEW.id THEN l.target_record_id ELSE l.source_record_id END FROM public.record_relations l
      WHERE l.tenant_id=NEW.tenant_id AND (l.source_record_id=NEW.id OR l.target_record_id=NEW.id) ORDER BY 1
    LOOP
      PERFORM public.lock_record_pool_objects(NEW.tenant_id,target_id);
      PERFORM 1 FROM public.records r WHERE r.tenant_id=NEW.tenant_id AND r.id=target_id AND r.deleted_at IS NULL FOR UPDATE;
      allow_new := NEW.deleted_at IS NULL
        AND public.record_pool_source_matches(NEW.tenant_id,target_id,NEW.object_id,NEW.status_key)
        AND (OLD.deleted_at IS NOT NULL OR NOT public.record_pool_source_matches(OLD.tenant_id,target_id,OLD.object_id,OLD.status_key));
      PERFORM public.refresh_record_pool_protection(NEW.tenant_id,target_id,allow_new);
    END LOOP;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' THEN
    FOR target_id IN SELECT id FROM (VALUES (NEW.source_record_id),(NEW.target_record_id)) endpoint(id) ORDER BY id
    LOOP
      PERFORM public.lock_record_pool_objects(NEW.tenant_id,target_id);
      PERFORM 1 FROM public.records r WHERE r.tenant_id=NEW.tenant_id AND r.id=target_id AND r.deleted_at IS NULL FOR UPDATE;
      SELECT r.* INTO source_record FROM public.records r WHERE r.tenant_id=NEW.tenant_id
        AND r.id=CASE WHEN target_id=NEW.source_record_id THEN NEW.target_record_id ELSE NEW.source_record_id END;
      allow_new := source_record.deleted_at IS NULL
        AND public.record_pool_source_matches(NEW.tenant_id,target_id,source_record.object_id,source_record.status_key);
      PERFORM public.refresh_record_pool_protection(NEW.tenant_id,target_id,allow_new);
    END LOOP;
    RETURN NEW;
  END IF;
  PERFORM public.refresh_record_pool_protection(OLD.tenant_id,LEAST(OLD.source_record_id,OLD.target_record_id),false);
  PERFORM public.refresh_record_pool_protection(OLD.tenant_id,GREATEST(OLD.source_record_id,OLD.target_record_id),false);
  RETURN OLD;
END;
$function$;
