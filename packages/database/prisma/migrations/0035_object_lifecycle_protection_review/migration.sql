-- Skip unchanged effective configuration as well as pure lifecycle changes.
-- A draft save may mention status/publication columns without changing them.
CREATE OR REPLACE FUNCTION public.review_record_pool_protection_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target_id uuid;
BEGIN
  IF NEW.active_publication_id IS NOT DISTINCT FROM OLD.active_publication_id
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
