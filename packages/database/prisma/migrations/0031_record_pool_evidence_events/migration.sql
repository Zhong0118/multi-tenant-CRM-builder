-- Only a new qualifying evidence event may start protection. Unrelated changes
-- must not resurrect old evidence after an administrator explicitly releases it.
CREATE FUNCTION public.record_pool_source_matches(target_tenant uuid, target_id uuid, source_object_id uuid, source_status text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.records target
    JOIN public.object_definitions target_object ON target_object.tenant_id=target.tenant_id AND target_object.id=target.object_id
    JOIN public.object_definitions source_object ON source_object.tenant_id=target.tenant_id AND source_object.id=source_object_id
    JOIN public.object_publications publication ON publication.tenant_id=source_object.tenant_id AND publication.id=source_object.active_publication_id AND publication.object_id=source_object.id
    CROSS JOIN LATERAL jsonb_array_elements(target_object.pool_protection_rules) rule
    WHERE target.tenant_id=target_tenant AND target.id=target_id AND target.deleted_at IS NULL
      AND source_object.status='ACTIVE' AND source_object.deleted_at IS NULL
      AND rule->>'sourceObjectCode'=source_object.code AND rule->'statusKeys' ? source_status
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(publication.configuration->'workflow'->'states','[]'::jsonb)) state WHERE state->>'key'=source_status)
  );
$function$;
REVOKE ALL ON FUNCTION public.record_pool_source_matches(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pool_source_matches(uuid,uuid,uuid,text) TO crm_app;

CREATE OR REPLACE FUNCTION public.sync_related_record_pool_protection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid; source_record public.records; allow_new boolean;
BEGIN
  IF TG_TABLE_NAME='records' THEN
    IF NEW.status_key IS NOT DISTINCT FROM OLD.status_key AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
    FOR target_id IN SELECT CASE WHEN l.source_record_id=NEW.id THEN l.target_record_id ELSE l.source_record_id END FROM public.record_relations l
      WHERE l.tenant_id=NEW.tenant_id AND (l.source_record_id=NEW.id OR l.target_record_id=NEW.id) ORDER BY 1
    LOOP
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
