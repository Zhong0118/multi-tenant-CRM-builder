-- Platform-wide business templates are separate from tenant-owned object
-- drafts. Published versions and application records form an append-only log.
CREATE TABLE "business_templates" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(1000),
  "draft_version" INTEGER NOT NULL DEFAULT 1,
  "draft_configuration" JSONB NOT NULL,
  "active_version_id" UUID,
  "published_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "business_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_template_versions" (
  "id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "version_no" INTEGER NOT NULL,
  "source_draft_version" INTEGER NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "configuration" JSONB NOT NULL,
  "configuration_checksum" CHAR(64) NOT NULL,
  "change_summary" JSONB NOT NULL,
  "published_by_user_id" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_template_applications" (
  "id" UUID NOT NULL,
  "template_version_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "applied_by_user_id" UUID NOT NULL,
  "configuration_checksum" CHAR(64) NOT NULL,
  "object_id_map" JSONB NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_template_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_templates_code_key"
ON "business_templates"("code");
CREATE UNIQUE INDEX "business_templates_active_version_id_key"
ON "business_templates"("active_version_id");
CREATE UNIQUE INDEX "business_template_versions_template_id_version_no_key"
ON "business_template_versions"("template_id", "version_no");
CREATE UNIQUE INDEX "business_template_applications_tenant_id_template_version_id_key"
ON "business_template_applications"("tenant_id", "template_version_id");

ALTER TABLE "business_templates"
  ADD CONSTRAINT "business_templates_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_template_versions"
  ADD CONSTRAINT "business_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "business_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_template_versions_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_templates"
  ADD CONSTRAINT "business_templates_active_version_id_fkey"
  FOREIGN KEY ("active_version_id") REFERENCES "business_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_template_applications"
  ADD CONSTRAINT "business_template_applications_template_version_id_fkey"
  FOREIGN KEY ("template_version_id") REFERENCES "business_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_template_applications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_template_applications_applied_by_user_id_fkey"
  FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "object_definitions"
  ADD CONSTRAINT "object_definitions_source_template_version_id_fkey"
  FOREIGN KEY ("source_template_version_id") REFERENCES "business_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_business_template_version_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'business_template_versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "business_template_versions_immutable_update"
BEFORE UPDATE ON "business_template_versions"
FOR EACH ROW EXECUTE FUNCTION "reject_business_template_version_update"();

GRANT SELECT, INSERT, UPDATE ON TABLE "business_templates" TO crm_app;
GRANT SELECT, INSERT ON TABLE
  "business_template_versions",
  "business_template_applications"
TO crm_app;

ALTER TABLE "business_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "business_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_template_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "business_template_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_template_applications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "business_templates_platform_admin_access" ON "business_templates"
TO crm_app
USING (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);

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
