-- Correct the broad policies installed by 0004 in databases that had already
-- applied it. Fresh databases receive the explicit policies directly from 0004.
DROP POLICY IF EXISTS "business_template_versions_platform_admin_access"
ON "business_template_versions";
DROP POLICY IF EXISTS "business_template_versions_platform_admin_select"
ON "business_template_versions";
DROP POLICY IF EXISTS "business_template_versions_platform_admin_insert"
ON "business_template_versions";
DROP POLICY IF EXISTS "business_template_applications_platform_admin_access"
ON "business_template_applications";
DROP POLICY IF EXISTS "business_template_applications_platform_admin_select"
ON "business_template_applications";
DROP POLICY IF EXISTS "business_template_applications_platform_admin_insert"
ON "business_template_applications";

CREATE POLICY "business_template_versions_platform_admin_select" ON "business_template_versions"
FOR SELECT TO crm_app
USING (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);

CREATE POLICY "business_template_versions_platform_admin_insert" ON "business_template_versions"
FOR INSERT TO crm_app
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);

CREATE POLICY "business_template_applications_platform_admin_select" ON "business_template_applications"
FOR SELECT TO crm_app
USING (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);

CREATE POLICY "business_template_applications_platform_admin_insert" ON "business_template_applications"
FOR INSERT TO crm_app
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);
