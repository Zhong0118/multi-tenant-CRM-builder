-- Named dashboards: one tenant may own many drafts, each with its own
-- immutable publication history. Existing single-row definitions become
-- the `home` dashboard and the company default for both roles.
--
-- Replay-safe: a previous attempt added the new columns, then failed when
-- the immutability trigger blocked the publication owner backfill. The
-- trigger is disabled only for that backfill, then re-enabled.

DO $$ BEGIN
  CREATE TYPE "DashboardStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "DashboardAudience" AS ENUM ('ALL', 'TENANT_ADMIN', 'EMPLOYEE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tenant_dashboard_configurations"
  ADD COLUMN IF NOT EXISTS "id" UUID,
  ADD COLUMN IF NOT EXISTS "code" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "status" "DashboardStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "audience" "DashboardAudience" NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "tenant_dashboard_configurations"
SET
  "id" = COALESCE("id", gen_random_uuid()),
  "code" = COALESCE("code", 'home'),
  "name" = COALESCE(
    "name",
    NULLIF("configuration" ->> 'title', ''),
    '工作台'
  );

ALTER TABLE "tenant_dashboard_configurations"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "tenant_dashboard_publications"
  ADD COLUMN IF NOT EXISTS "dashboard_id" UUID;

ALTER TABLE "tenant_dashboard_publications"
  DISABLE TRIGGER "tenant_dashboard_publications_immutable_update";

UPDATE "tenant_dashboard_publications" AS publication
SET "dashboard_id" = definition."id"
FROM "tenant_dashboard_configurations" AS definition
WHERE definition."tenant_id" = publication."tenant_id"
  AND publication."dashboard_id" IS DISTINCT FROM definition."id";

ALTER TABLE "tenant_dashboard_publications"
  ENABLE TRIGGER "tenant_dashboard_publications_immutable_update";

ALTER TABLE "tenant_dashboard_publications"
  ALTER COLUMN "dashboard_id" SET NOT NULL;

ALTER TABLE "tenant_dashboard_configurations"
  DROP CONSTRAINT IF EXISTS "tenant_dashboard_configurations_tenant_id_active_publication_id_fkey";
ALTER TABLE "tenant_dashboard_configurations"
  DROP CONSTRAINT IF EXISTS "tenant_dashboard_configurations_tenant_id_active_publication_id";

ALTER TABLE "tenant_dashboard_publications"
  DROP CONSTRAINT IF EXISTS "tenant_dashboard_publications_tenant_id_definition_fkey";

DROP INDEX IF EXISTS "tenant_dashboard_configurations_tenant_id_active_publication_id_key";
DROP INDEX IF EXISTS "tenant_dashboard_configurations_tenant_id_active_publication_id";
DROP INDEX IF EXISTS "tenant_dashboard_publications_tenant_id_publication_no_key";

DO $$ BEGIN
  ALTER TABLE "tenant_dashboard_configurations"
    DROP CONSTRAINT "tenant_dashboard_configurations_pkey";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_dashboard_configurations"
    ADD CONSTRAINT "tenant_dashboard_configurations_pkey" PRIMARY KEY ("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_dashboard_configurations_tenant_id_code_key"
  ON "tenant_dashboard_configurations"("tenant_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_dashboard_configurations_tenant_id_id_key"
  ON "tenant_dashboard_configurations"("tenant_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_dashboard_configurations_tenant_id_active_publication_id_key"
  ON "tenant_dashboard_configurations"("tenant_id", "active_publication_id");
CREATE INDEX IF NOT EXISTS "tenant_dashboard_configurations_tenant_id_status_sort_order_idx"
  ON "tenant_dashboard_configurations"("tenant_id", "status", "sort_order");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_dashboard_publications_dashboard_id_publication_no_key"
  ON "tenant_dashboard_publications"("dashboard_id", "publication_no");
CREATE INDEX IF NOT EXISTS "tenant_dashboard_publications_tenant_id_dashboard_id_published_at_idx"
  ON "tenant_dashboard_publications"("tenant_id", "dashboard_id", "published_at" DESC);

DO $$ BEGIN
  ALTER TABLE "tenant_dashboard_publications"
    ADD CONSTRAINT "tenant_dashboard_publications_tenant_id_definition_fkey"
    FOREIGN KEY ("tenant_id", "dashboard_id")
    REFERENCES "tenant_dashboard_configurations"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_dashboard_configurations"
    ADD CONSTRAINT "tenant_dashboard_configurations_tenant_id_active_publication_id_fkey"
    FOREIGN KEY ("tenant_id", "active_publication_id")
    REFERENCES "tenant_dashboard_publications"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "default_admin_dashboard_id" UUID,
  ADD COLUMN IF NOT EXISTS "default_employee_dashboard_id" UUID;

UPDATE "tenants" AS tenant
SET
  "default_admin_dashboard_id" = definition."id",
  "default_employee_dashboard_id" = definition."id"
FROM "tenant_dashboard_configurations" AS definition
WHERE definition."tenant_id" = tenant."id"
  AND definition."code" = 'home';

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_id_default_admin_dashboard_id_fkey"
  FOREIGN KEY ("id", "default_admin_dashboard_id")
  REFERENCES "tenant_dashboard_configurations"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenants_id_default_employee_dashboard_id_fkey"
  FOREIGN KEY ("id", "default_employee_dashboard_id")
  REFERENCES "tenant_dashboard_configurations"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
