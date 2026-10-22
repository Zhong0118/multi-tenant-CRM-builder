-- Lifecycle metadata is additive; no business records or publications are rewritten.
ALTER TABLE public.object_definitions
  ADD COLUMN archived_at timestamptz(3),
  ADD COLUMN lifecycle_version_offset integer NOT NULL DEFAULT 0;
ALTER TABLE public.object_definitions ADD CONSTRAINT object_lifecycle_offset_nonnegative CHECK (lifecycle_version_offset >= 0);

-- Pure stop/resume preserves the exact protection review state. Real publication
-- or pool configuration changes still run the existing evidence review.
CREATE OR REPLACE FUNCTION public.review_record_pool_protection_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.active_publication_id IS NOT DISTINCT FROM OLD.active_publication_id
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
    AND NEW.pool_enabled IS NOT DISTINCT FROM OLD.pool_enabled
    AND NEW.pool_lifecycle_enabled IS NOT DISTINCT FROM OLD.pool_lifecycle_enabled
    AND NEW.pool_protection_rules IS NOT DISTINCT FROM OLD.pool_protection_rules
  THEN RETURN NEW; END IF;
  FOR target_id IN SELECT r.id FROM public.records r WHERE r.tenant_id=NEW.tenant_id AND r.pool_stage='PROTECTED' AND r.deleted_at IS NULL AND
    (r.object_id=NEW.id OR EXISTS(SELECT 1 FROM public.record_relations l JOIN public.records s ON s.tenant_id=l.tenant_id AND s.id=CASE WHEN l.source_record_id=r.id THEN l.target_record_id ELSE l.source_record_id END
      WHERE l.tenant_id=r.tenant_id AND (l.source_record_id=r.id OR l.target_record_id=r.id) AND s.object_id=NEW.id)) ORDER BY r.id
  LOOP PERFORM public.refresh_record_pool_protection(NEW.tenant_id,target_id,false); END LOOP;
  RETURN NEW;
END;
$function$;

-- Related evidence edits must not mutate the protection state of stopped tables.
CREATE OR REPLACE FUNCTION public.refresh_record_pool_protection(target_tenant uuid, target_id uuid, allow_new boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target public.records; valid_evidence boolean; lifecycle boolean; next_review boolean; event_time timestamptz;
BEGIN
  -- The target lock precedes the evidence read. Concurrent independent source
  -- invalidations therefore see committed evidence after waiting for this row.
  PERFORM public.lock_record_pool_objects(target_tenant,target_id);
  SELECT r.* INTO target FROM public.records r WHERE r.tenant_id=target_tenant AND r.id=target_id AND r.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.object_definitions o WHERE o.tenant_id=target_tenant AND o.id=target.object_id AND o.status='ARCHIVED') THEN RETURN; END IF;
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
