BEGIN;

-- Creating a company's first dashboard also writes its default pointers.
-- Company admins need UPDATE access to their own tenant for those fields only.
CREATE POLICY "tenants_admin_dashboard_defaults_update" ON "tenants"
FOR UPDATE TO crm_app
USING (
  "id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND "status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "tenant_members" AS member
    JOIN "users" AS account ON account."id" = member."user_id"
    WHERE member."tenant_id" = "tenants"."id"
      AND member."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND member."role" = 'TENANT_ADMIN'
      AND member."status" = 'ACTIVE'
      AND account."status" = 'ACTIVE'
  )
);
-- For UPDATE, PostgreSQL also uses USING as WITH CHECK when it is omitted.

-- RLS limits rows, not columns. Keep lifecycle/settings edits platform-only,
-- while allowing Prisma's updated_at alongside the two default pointers.
CREATE FUNCTION "restrict_tenant_admin_updates"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'crm_app'
    AND NOT EXISTS (
      SELECT 1 FROM public."users"
      WHERE "id" = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND "is_platform_admin" = true
        AND "status" = 'ACTIVE'
    )
    AND (to_jsonb(NEW) - ARRAY['default_admin_dashboard_id', 'default_employee_dashboard_id', 'updated_at'])
      IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['default_admin_dashboard_id', 'default_employee_dashboard_id', 'updated_at'])
  THEN
    RAISE EXCEPTION 'Company administrators may only update default dashboard pointers'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenants_restrict_admin_updates"
BEFORE UPDATE ON "tenants"
FOR EACH ROW EXECUTE FUNCTION "restrict_tenant_admin_updates"();

COMMIT;
