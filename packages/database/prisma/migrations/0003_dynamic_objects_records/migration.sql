-- CreateEnum
CREATE TYPE "ViewType" AS ENUM ('TABLE');
CREATE TYPE "ViewStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PermissionSubjectType" AS ENUM ('ROLE', 'MEMBER');
CREATE TYPE "DataScope" AS ENUM ('ALL', 'OWN', 'NONE');
CREATE TYPE "FieldAccess" AS ENUM ('EDIT', 'READ_ONLY', 'HIDDEN');

-- Extend editable object drafts with publication state and navigation order.
ALTER TABLE "object_definitions"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active_publication_id" UUID,
  ADD COLUMN "published_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "field_definitions_tenant_id_object_id_id_key"
ON "field_definitions"("tenant_id", "object_id", "id");

CREATE UNIQUE INDEX "object_definitions_tenant_id_active_publication_id_key"
ON "object_definitions"("tenant_id", "active_publication_id");

DROP INDEX "object_definitions_tenant_id_status_idx";
CREATE INDEX "object_definitions_tenant_id_status_sort_order_idx"
ON "object_definitions"("tenant_id", "status", "sort_order");

-- Immutable runtime snapshots.
CREATE TABLE "object_publications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "publication_no" INTEGER NOT NULL,
  "source_draft_version" INTEGER NOT NULL,
  "configuration" JSONB NOT NULL,
  "change_summary" JSONB NOT NULL,
  "published_by_member_id" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "object_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "view_definitions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "type" "ViewType" NOT NULL DEFAULT 'TABLE',
  "column_field_keys" JSONB NOT NULL,
  "sort" JSONB NOT NULL,
  "status" "ViewStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "view_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_permissions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "subject_type" "PermissionSubjectType" NOT NULL,
  "subject_role" "MemberRole",
  "subject_member_id" UUID,
  "can_create" BOOLEAN NOT NULL DEFAULT false,
  "can_read" BOOLEAN NOT NULL DEFAULT false,
  "can_update" BOOLEAN NOT NULL DEFAULT false,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  "read_scope" "DataScope" NOT NULL DEFAULT 'NONE',
  "update_scope" "DataScope" NOT NULL DEFAULT 'NONE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "object_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "object_permissions_subject_shape" CHECK (
    ("subject_type" = 'ROLE' AND "subject_role" IS NOT NULL AND "subject_member_id" IS NULL)
    OR
    ("subject_type" = 'MEMBER' AND "subject_role" IS NULL AND "subject_member_id" IS NOT NULL)
  ),
  CONSTRAINT "object_permissions_employee_delete_false" CHECK (
    "subject_type" <> 'ROLE' OR "subject_role" <> 'EMPLOYEE' OR "can_delete" = false
  )
);

CREATE TABLE "field_permissions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "field_id" UUID NOT NULL,
  "subject_role" "MemberRole" NOT NULL,
  "access" "FieldAccess" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "field_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_permissions_employee_only" CHECK ("subject_role" = 'EMPLOYEE')
);

CREATE TABLE "record_counters" (
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "next_record_no" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "record_counters_pkey" PRIMARY KEY ("tenant_id", "object_id"),
  CONSTRAINT "record_counters_positive" CHECK ("next_record_no" > 0)
);

-- Indexes and subject uniqueness.
CREATE UNIQUE INDEX "object_publications_tenant_id_object_id_publication_no_key"
ON "object_publications"("tenant_id", "object_id", "publication_no");
CREATE UNIQUE INDEX "object_publications_tenant_id_id_key"
ON "object_publications"("tenant_id", "id");
CREATE INDEX "object_publications_tenant_id_object_id_published_at_idx"
ON "object_publications"("tenant_id", "object_id", "published_at" DESC);

CREATE UNIQUE INDEX "view_definitions_tenant_id_object_id_code_key"
ON "view_definitions"("tenant_id", "object_id", "code");
CREATE INDEX "view_definitions_tenant_id_object_id_status_idx"
ON "view_definitions"("tenant_id", "object_id", "status");

CREATE UNIQUE INDEX "object_permissions_one_role_policy"
ON "object_permissions"("tenant_id", "object_id", "subject_role")
WHERE "subject_type" = 'ROLE';
CREATE UNIQUE INDEX "object_permissions_one_member_policy"
ON "object_permissions"("tenant_id", "object_id", "subject_member_id")
WHERE "subject_type" = 'MEMBER';
CREATE INDEX "object_permissions_tenant_id_object_id_subject_type_idx"
ON "object_permissions"("tenant_id", "object_id", "subject_type");

CREATE UNIQUE INDEX "field_permissions_tenant_id_field_id_subject_role_key"
ON "field_permissions"("tenant_id", "field_id", "subject_role");
CREATE INDEX "field_permissions_tenant_id_object_id_subject_role_idx"
ON "field_permissions"("tenant_id", "object_id", "subject_role");

-- Foreign keys preserve tenant identity at every join.
ALTER TABLE "object_publications"
  ADD CONSTRAINT "object_publications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_publications_tenant_id_object_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_publications_tenant_id_published_by_member_id_fkey"
  FOREIGN KEY ("tenant_id", "published_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "object_definitions"
  ADD CONSTRAINT "object_definitions_tenant_id_active_publication_id_fkey"
  FOREIGN KEY ("tenant_id", "active_publication_id") REFERENCES "object_publications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "view_definitions"
  ADD CONSTRAINT "view_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "view_definitions_tenant_id_object_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "object_permissions"
  ADD CONSTRAINT "object_permissions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_permissions_tenant_id_object_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_permissions_tenant_id_subject_member_id_fkey"
  FOREIGN KEY ("tenant_id", "subject_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "field_permissions"
  ADD CONSTRAINT "field_permissions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "field_permissions_tenant_id_object_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "field_permissions_tenant_id_object_id_field_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id", "field_id") REFERENCES "field_definitions"("tenant_id", "object_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "record_counters"
  ADD CONSTRAINT "record_counters_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_counters_tenant_id_object_id_fkey"
  FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Publications cannot be edited. Migration administrators retain DELETE for
-- controlled test cleanup; the application role receives no DELETE grant.
CREATE FUNCTION "reject_object_publication_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'object_publications are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "object_publications_immutable_update"
BEFORE UPDATE ON "object_publications"
FOR EACH ROW EXECUTE FUNCTION "reject_object_publication_update"();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "view_definitions",
  "object_permissions",
  "field_permissions",
  "record_counters"
TO crm_app;
GRANT SELECT, INSERT ON TABLE "object_publications" TO crm_app;

ALTER TABLE "object_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "object_publications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "view_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "view_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "object_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "object_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "field_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "record_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY "object_publications_tenant_access" ON "object_publications"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "view_definitions_tenant_access" ON "view_definitions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "object_permissions_tenant_access" ON "object_permissions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "field_permissions_tenant_access" ON "field_permissions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "record_counters_tenant_access" ON "record_counters"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
