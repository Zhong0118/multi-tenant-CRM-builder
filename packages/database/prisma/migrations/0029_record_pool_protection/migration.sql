-- Conversion protection follows real record relations and immutable published
-- workflow states. No historical record is changed when this migration runs.
CREATE FUNCTION public.record_pool_has_evidence(target_tenant uuid, target_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.records target
    JOIN public.object_definitions target_object ON target_object.tenant_id=target.tenant_id AND target_object.id=target.object_id
    JOIN public.record_relations relation ON relation.tenant_id=target.tenant_id AND (relation.source_record_id=target.id OR relation.target_record_id=target.id)
    JOIN public.records source ON source.tenant_id=relation.tenant_id AND source.id=CASE WHEN relation.source_record_id=target.id THEN relation.target_record_id ELSE relation.source_record_id END
    JOIN public.object_definitions source_object ON source_object.tenant_id=source.tenant_id AND source_object.id=source.object_id
    JOIN public.object_publications publication ON publication.tenant_id=source_object.tenant_id AND publication.id=source_object.active_publication_id AND publication.object_id=source_object.id
    CROSS JOIN LATERAL jsonb_array_elements(target_object.pool_protection_rules) rule
    WHERE target.tenant_id=target_tenant AND target.id=target_id AND target.deleted_at IS NULL
      AND source.deleted_at IS NULL AND source_object.status='ACTIVE' AND source_object.deleted_at IS NULL
      AND rule->>'sourceObjectCode'=source_object.code AND rule->'statusKeys' ? source.status_key
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(publication.configuration->'workflow'->'states','[]'::jsonb)) state WHERE state->>'key'=source.status_key)
  );
$function$;

-- Invoker rights preserve tenant RLS. New protection also checks the target's
-- published access, current member override, title visibility and OWN scope.
CREATE FUNCTION public.record_pool_can_protect(target public.records)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE actor public.tenant_members; snapshot jsonb; access jsonb; title_access text; title_key text;
BEGIN
  SELECT m.* INTO actor FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id
  WHERE m.tenant_id=target.tenant_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.status='ACTIVE' AND u.status='ACTIVE';
  IF NOT FOUND OR target.tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id',true),'')::uuid THEN RETURN false; END IF;
  SELECT p.configuration INTO snapshot FROM public.object_definitions o JOIN public.object_publications p ON p.tenant_id=o.tenant_id AND p.id=o.active_publication_id AND p.object_id=o.id
  WHERE o.tenant_id=target.tenant_id AND o.id=target.object_id AND o.status='ACTIVE' AND o.deleted_at IS NULL;
  IF snapshot IS NULL THEN RETURN false; END IF;
  IF actor.role='TENANT_ADMIN' THEN RETURN true; END IF;
  IF snapshot->'employeeAccess' IS NULL THEN RETURN false; END IF;
  SELECT jsonb_build_object('canRead',p.can_read,'canUpdate',p.can_update,'readScope',p.read_scope,'updateScope',p.update_scope) INTO access FROM public.object_permissions p
  WHERE p.tenant_id=target.tenant_id AND p.object_id=target.object_id AND p.subject_type='MEMBER' AND p.subject_member_id=actor.id LIMIT 1;
  access := COALESCE(access,snapshot->'employeeAccess');
  title_key := snapshot->'object'->>'titleFieldKey';
  SELECT permission.access::text INTO title_access FROM public.member_field_permissions permission JOIN public.field_definitions field ON field.tenant_id=permission.tenant_id AND field.id=permission.field_id
  WHERE permission.tenant_id=target.tenant_id AND permission.object_id=target.object_id AND permission.member_id=actor.id AND field.field_key=title_key;
  title_access := COALESCE(title_access,snapshot->'employeeAccess'->'fields'->>title_key,'EDIT');
  RETURN COALESCE((access->>'canRead')::boolean,false) AND COALESCE((access->>'canUpdate')::boolean,false)
    AND access->>'readScope' IN ('ALL','OWN') AND access->>'updateScope' IN ('ALL','OWN') AND title_access<>'HIDDEN'
    AND (access->>'readScope'='ALL' OR target.owner_member_id=actor.id)
    AND (access->>'updateScope'='ALL' OR target.owner_member_id=actor.id);
END;
$function$;

CREATE FUNCTION public.refresh_record_pool_protection(target_tenant uuid, target_id uuid, allow_new boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target public.records; valid_evidence boolean; lifecycle boolean; next_review boolean;
BEGIN
  -- The target lock precedes the evidence read. Concurrent independent source
  -- invalidations therefore see committed evidence after waiting for this row.
  SELECT r.* INTO target FROM public.records r WHERE r.tenant_id=target_tenant AND r.id=target_id AND r.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT o.pool_enabled AND o.pool_lifecycle_enabled AND o.status='ACTIVE' AND o.deleted_at IS NULL INTO lifecycle FROM public.object_definitions o WHERE o.tenant_id=target_tenant AND o.id=target.object_id;
  IF NOT COALESCE(lifecycle,false) AND target.pool_stage IS DISTINCT FROM 'PROTECTED' THEN RETURN; END IF;
  valid_evidence := COALESCE(lifecycle,false) AND public.record_pool_has_evidence(target_tenant,target_id);
  IF target.pool_stage='PROTECTED' THEN
    next_review := NOT valid_evidence;
    IF target.protection_needs_review=next_review THEN RETURN; END IF;
    UPDATE public.records SET protection_needs_review=next_review,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=target_tenant AND id=target_id;
  ELSIF valid_evidence AND allow_new THEN
    IF NOT public.record_pool_can_protect(target) THEN RAISE EXCEPTION 'POOL_PROTECTION_FORBIDDEN' USING ERRCODE='P0001'; END IF;
    IF target.owner_member_id IS NULL OR target.in_public_pool THEN RAISE EXCEPTION 'POOL_PROTECTION_OWNER_REQUIRED' USING ERRCODE='P0001'; END IF;
    IF target.pool_stage IN ('PENDING_CONTACT','FOLLOWING') AND target.ownership_expires_at <= statement_timestamp() THEN
      RAISE EXCEPTION 'POOL_PROTECTION_EXPIRED' USING ERRCODE='P0001';
    END IF;
    UPDATE public.records SET pool_stage='PROTECTED',pool_protected_at=CURRENT_TIMESTAMP,ownership_expires_at=NULL,protection_needs_review=false,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=target_tenant AND id=target_id;
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

CREATE FUNCTION public.sync_related_record_pool_protection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid;
BEGIN
  IF TG_TABLE_NAME='records' THEN
    IF NEW.status_key IS NOT DISTINCT FROM OLD.status_key AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
    FOR target_id IN SELECT CASE WHEN l.source_record_id=NEW.id THEN l.target_record_id ELSE l.source_record_id END FROM public.record_relations l
      WHERE l.tenant_id=NEW.tenant_id AND (l.source_record_id=NEW.id OR l.target_record_id=NEW.id) ORDER BY 1
    LOOP PERFORM public.refresh_record_pool_protection(NEW.tenant_id,target_id); END LOOP;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM public.refresh_record_pool_protection(NEW.tenant_id,LEAST(NEW.source_record_id,NEW.target_record_id));
    PERFORM public.refresh_record_pool_protection(NEW.tenant_id,GREATEST(NEW.source_record_id,NEW.target_record_id));
    RETURN NEW;
  END IF;
  PERFORM public.refresh_record_pool_protection(OLD.tenant_id,LEAST(OLD.source_record_id,OLD.target_record_id));
  PERFORM public.refresh_record_pool_protection(OLD.tenant_id,GREATEST(OLD.source_record_id,OLD.target_record_id));
  RETURN OLD;
END;
$function$;
CREATE TRIGGER records_sync_pool_protection AFTER UPDATE OF status_key,deleted_at ON public.records FOR EACH ROW EXECUTE FUNCTION public.sync_related_record_pool_protection();
CREATE TRIGGER record_relations_sync_pool_protection AFTER INSERT OR DELETE ON public.record_relations FOR EACH ROW EXECUTE FUNCTION public.sync_related_record_pool_protection();

-- Publication replacement, source archival and rule removal can invalidate an
-- existing protection. Settings changes never enroll old records in the flow.
CREATE FUNCTION public.review_record_pool_protection_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid;
BEGIN
  FOR target_id IN SELECT r.id FROM public.records r WHERE r.tenant_id=NEW.tenant_id AND r.pool_stage='PROTECTED' AND r.deleted_at IS NULL AND
    (r.object_id=NEW.id OR EXISTS(SELECT 1 FROM public.record_relations l JOIN public.records s ON s.tenant_id=l.tenant_id AND s.id=CASE WHEN l.source_record_id=r.id THEN l.target_record_id ELSE l.source_record_id END
      WHERE l.tenant_id=r.tenant_id AND (l.source_record_id=r.id OR l.target_record_id=r.id) AND s.object_id=NEW.id)) ORDER BY r.id
  LOOP PERFORM public.refresh_record_pool_protection(NEW.tenant_id,target_id,false); END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER objects_review_pool_protection AFTER UPDATE OF active_publication_id,status,deleted_at,pool_enabled,pool_lifecycle_enabled,pool_protection_rules ON public.object_definitions FOR EACH ROW EXECUTE FUNCTION public.review_record_pool_protection_configuration();

-- These are invoker functions: no elevated role and no tenant bypass. Trigger
-- helpers are intentionally not exposed as callable runtime commands.
REVOKE ALL ON FUNCTION public.refresh_record_pool_protection(uuid,uuid,boolean),public.record_pool_has_evidence(uuid,uuid),public.record_pool_can_protect(public.records),public.sync_related_record_pool_protection(),public.review_record_pool_protection_configuration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_record_pool_protection(uuid,uuid,boolean),public.record_pool_has_evidence(uuid,uuid),public.record_pool_can_protect(public.records) TO crm_app;
