-- Evolve the existing dashboard row into an editable definition without
-- renaming or rewriting the legacy version/configuration columns.
ALTER TABLE "tenant_dashboard_configurations"
  ADD COLUMN "active_publication_id" UUID,
  ADD COLUMN "source_template_version_id" UUID;

-- Dashboard publications are immutable, tenant-scoped runtime snapshots.
-- The publisher is nullable only so legacy rows can be backfilled without
-- inventing an actor; application-created publications always provide one.
CREATE TABLE "tenant_dashboard_publications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "publication_no" INTEGER NOT NULL,
  "source_draft_version" INTEGER NOT NULL,
  "configuration" JSONB NOT NULL,
  "published_by_member_id" UUID,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_dashboard_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_dashboard_publications_tenant_id_publication_no_key"
ON "tenant_dashboard_publications"("tenant_id", "publication_no");
CREATE UNIQUE INDEX "tenant_dashboard_publications_tenant_id_id_key"
ON "tenant_dashboard_publications"("tenant_id", "id");
CREATE INDEX "tenant_dashboard_publications_tenant_id_published_at_idx"
ON "tenant_dashboard_publications"("tenant_id", "published_at" DESC);
CREATE UNIQUE INDEX "tenant_dashboard_configurations_tenant_id_active_publication_id_key"
ON "tenant_dashboard_configurations"("tenant_id", "active_publication_id");

ALTER TABLE "tenant_dashboard_publications"
  ADD CONSTRAINT "tenant_dashboard_publications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_dashboard_publications_tenant_id_definition_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant_dashboard_configurations"("tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_dashboard_publications_tenant_id_published_by_member_id_fkey"
  FOREIGN KEY ("tenant_id", "published_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_dashboard_configurations"
  ADD CONSTRAINT "tenant_dashboard_configurations_source_template_version_id_fkey"
  FOREIGN KEY ("source_template_version_id") REFERENCES "business_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the exact legacy JSON as publication 1. Runtime compatibility is
-- provided by the application adapter, not by an irreversible SQL rewrite.
INSERT INTO "tenant_dashboard_publications" (
  "id",
  "tenant_id",
  "publication_no",
  "source_draft_version",
  "configuration",
  "published_by_member_id",
  "published_at"
)
SELECT
  gen_random_uuid(),
  "tenant_id",
  1,
  "version",
  "configuration",
  NULL,
  "updated_at"
FROM "tenant_dashboard_configurations";

UPDATE "tenant_dashboard_configurations" AS definition
SET "active_publication_id" = publication."id"
FROM "tenant_dashboard_publications" AS publication
WHERE publication."tenant_id" = definition."tenant_id"
  AND publication."publication_no" = 1;

-- The active-publication foreign key is deliberately installed only after the
-- legacy rows have been backfilled and their pointers populated.
ALTER TABLE "tenant_dashboard_configurations"
  ADD CONSTRAINT "tenant_dashboard_configurations_tenant_id_active_publication_id_fkey"
  FOREIGN KEY ("tenant_id", "active_publication_id") REFERENCES "tenant_dashboard_publications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_tenant_dashboard_publication_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tenant_dashboard_publications are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_dashboard_publications_immutable_update"
BEFORE UPDATE ON "tenant_dashboard_publications"
FOR EACH ROW EXECUTE FUNCTION "reject_tenant_dashboard_publication_update"();

GRANT SELECT, INSERT ON TABLE "tenant_dashboard_publications" TO crm_app;

ALTER TABLE "tenant_dashboard_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_dashboard_publications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_dashboard_publications_tenant_access"
ON "tenant_dashboard_publications"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);
