-- No historical records are made public or assigned a deadline.
ALTER TABLE public.object_definitions
  ADD COLUMN pool_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN pool_ownership_ttl_hours integer,
  ADD COLUMN pool_config_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT object_pool_ttl_range CHECK (pool_ownership_ttl_hours BETWEEN 1 AND 8760),
  ADD CONSTRAINT object_pool_version_positive CHECK (pool_config_version > 0);
ALTER TABLE public.records
  ADD COLUMN in_public_pool boolean NOT NULL DEFAULT false,
  ADD COLUMN ownership_expires_at timestamptz(3),
  ADD CONSTRAINT record_pool_owner_exclusive CHECK (NOT in_public_pool OR owner_member_id IS NULL),
  ADD CONSTRAINT record_deadline_requires_owner CHECK (ownership_expires_at IS NULL OR owner_member_id IS NOT NULL);
CREATE INDEX records_pool_expiry_idx ON public.records (ownership_expires_at, tenant_id, object_id)
  WHERE deleted_at IS NULL AND ownership_expires_at IS NOT NULL AND NOT in_public_pool;
CREATE INDEX records_pool_list_idx ON public.records (tenant_id, object_id, updated_at DESC)
  WHERE deleted_at IS NULL AND in_public_pool;

-- All existing owner mutation paths (workflow, import, ordinary edits) keep the
-- system attributes consistent. Content-only edits leave an existing TTL alone.
CREATE FUNCTION public.keep_record_ownership_consistent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF NEW.owner_member_id IS NOT NULL THEN NEW.in_public_pool := false; END IF;
  IF NEW.owner_member_id IS NULL THEN NEW.ownership_expires_at := NULL;
  ELSIF NEW.owner_member_id IS DISTINCT FROM OLD.owner_member_id THEN
    NEW.ownership_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER records_keep_ownership_consistent BEFORE UPDATE ON public.records
FOR EACH ROW EXECUTE FUNCTION public.keep_record_ownership_consistent();

-- A non-login, non-bypass role can only see eligible objects/records and write
-- reclaimed ownership + system audits. The app receives only function execution.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_pool_reclaimer') THEN
    CREATE ROLE crm_pool_reclaimer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE crm_pool_reclaimer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO crm_pool_reclaimer;
GRANT SELECT ON public.tenants, public.object_definitions, public.records TO crm_pool_reclaimer;
GRANT UPDATE (pool_config_version) ON public.object_definitions TO crm_pool_reclaimer;
GRANT UPDATE (owner_member_id, in_public_pool, ownership_expires_at, version, updated_at) ON public.records TO crm_pool_reclaimer;
GRANT INSERT ON public.audit_logs TO crm_pool_reclaimer;
CREATE POLICY tenants_pool_reclaimer ON public.tenants FOR SELECT TO crm_pool_reclaimer USING (status = 'ACTIVE');
CREATE POLICY objects_pool_reclaimer_read ON public.object_definitions FOR SELECT TO crm_pool_reclaimer
  USING (pool_enabled AND status = 'ACTIVE' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.status = 'ACTIVE'));
CREATE POLICY objects_pool_reclaimer_lock ON public.object_definitions FOR UPDATE TO crm_pool_reclaimer
  USING (pool_enabled AND status = 'ACTIVE' AND deleted_at IS NULL) WITH CHECK (false);
CREATE POLICY records_pool_reclaimer_read ON public.records FOR SELECT TO crm_pool_reclaimer
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.object_definitions o WHERE o.id = object_id AND o.tenant_id = records.tenant_id));
CREATE POLICY records_pool_reclaimer_update ON public.records FOR UPDATE TO crm_pool_reclaimer
  USING (deleted_at IS NULL AND NOT in_public_pool AND owner_member_id IS NOT NULL AND ownership_expires_at <= CURRENT_TIMESTAMP)
  WITH CHECK (in_public_pool AND owner_member_id IS NULL AND ownership_expires_at IS NULL);
CREATE POLICY audits_pool_reclaimer ON public.audit_logs FOR INSERT TO crm_pool_reclaimer
  WITH CHECK (actor_type = 'SYSTEM' AND actor_id IS NULL AND action = 'record.ownership_reclaimed' AND resource_type = 'record');

CREATE FUNCTION public.reclaim_expired_record_ownership(batch_size integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  object_row record;
  record_row record;
  reclaimed integer := 0;
  bounded_size integer := LEAST(GREATEST(COALESCE(batch_size, 100), 1), 100);
BEGIN
  -- Lock configuration before records, matching the HTTP flow. A disable waits
  -- for an in-flight sweep; a completed disable prevents all later reclamation.
  FOR object_row IN
    SELECT o.id, o.tenant_id FROM public.object_definitions o
    WHERE o.pool_enabled AND o.status = 'ACTIVE' AND o.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = o.tenant_id AND t.status = 'ACTIVE')
      AND EXISTS (SELECT 1 FROM public.records r WHERE r.object_id = o.id
        AND r.tenant_id = o.tenant_id AND r.deleted_at IS NULL AND NOT r.in_public_pool
        AND r.owner_member_id IS NOT NULL AND r.ownership_expires_at <= CURRENT_TIMESTAMP)
    ORDER BY o.id LIMIT 100 FOR SHARE OF o SKIP LOCKED
  LOOP
    FOR record_row IN
      SELECT r.id, r.owner_member_id, r.ownership_expires_at, r.version
      FROM public.records r WHERE r.tenant_id = object_row.tenant_id AND r.object_id = object_row.id
        AND r.deleted_at IS NULL AND NOT r.in_public_pool AND r.owner_member_id IS NOT NULL
        AND r.ownership_expires_at <= CURRENT_TIMESTAMP
      ORDER BY r.ownership_expires_at, r.id LIMIT (bounded_size - reclaimed)
      FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE public.records SET owner_member_id = NULL, in_public_pool = true,
        ownership_expires_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = record_row.id AND version = record_row.version;
      IF FOUND THEN
        INSERT INTO public.audit_logs (tenant_id, actor_type, action, resource_type, resource_id, "before", "after", request_id)
        VALUES (object_row.tenant_id, 'SYSTEM', 'record.ownership_reclaimed', 'record', record_row.id,
          jsonb_build_object('ownerMemberId', record_row.owner_member_id, 'inPublicPool', false, 'ownershipExpiresAt', record_row.ownership_expires_at, 'version', record_row.version),
          jsonb_build_object('ownerMemberId', NULL, 'inPublicPool', true, 'ownershipExpiresAt', NULL, 'version', record_row.version + 1),
          'record-pool-sweep');
        reclaimed := reclaimed + 1;
      END IF;
    END LOOP;
    EXIT WHEN reclaimed >= bounded_size;
  END LOOP;
  RETURN reclaimed;
END;
$function$;
GRANT CREATE ON SCHEMA public TO crm_pool_reclaimer;
ALTER FUNCTION public.reclaim_expired_record_ownership(integer) OWNER TO crm_pool_reclaimer;
REVOKE CREATE ON SCHEMA public FROM crm_pool_reclaimer;
REVOKE ALL ON FUNCTION public.reclaim_expired_record_ownership(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclaim_expired_record_ownership(integer) TO crm_app;
