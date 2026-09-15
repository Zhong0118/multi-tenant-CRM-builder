-- Tenant-scoped workflow drafts plus append-only record transition history.
-- Runtime state reuses records.status_key; this migration does not add a
-- second state column.

CREATE TABLE "object_workflow_definitions" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "object_definition_id" UUID NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT false,
  "initial_state_key" VARCHAR(64),
  "created_by_member_id" UUID NOT NULL,
  "updated_by_member_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "object_workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_state_definitions" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "workflow_definition_id" UUID NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  "description" VARCHAR(1000),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_terminal" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_state_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_state_definitions_key_format"
    CHECK ("key" ~ '^[a-z][a-z0-9-]{0,63}$'),
  CONSTRAINT "workflow_state_definitions_label_not_blank"
    CHECK (char_length(btrim("label")) > 0)
);

CREATE TABLE "workflow_transition_definitions" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "workflow_definition_id" UUID NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  "from_state_key" VARCHAR(64) NOT NULL,
  "to_state_key" VARCHAR(64) NOT NULL,
  "allowed_roles" "MemberRole"[] NOT NULL,
  "required_field_keys" TEXT[] NOT NULL DEFAULT '{}',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_transition_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_transition_definitions_key_format"
    CHECK ("key" ~ '^[a-z][a-z0-9-]{0,63}$'),
  CONSTRAINT "workflow_transition_definitions_key_not_reserved"
    CHECK (left("key", 2) <> '__'),
  CONSTRAINT "workflow_transition_definitions_label_not_blank"
    CHECK (char_length(btrim("label")) > 0),
  CONSTRAINT "workflow_transition_definitions_from_to_distinct"
    CHECK ("from_state_key" <> "to_state_key"),
  CONSTRAINT "workflow_transition_definitions_allowed_roles_present"
    CHECK (cardinality("allowed_roles") > 0)
);

CREATE TABLE "record_transition_histories" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "object_definition_id" UUID NOT NULL,
  "record_id" UUID NOT NULL,
  "object_publication_id" UUID NOT NULL,
  "transition_key" VARCHAR(64) NOT NULL,
  "transition_label" VARCHAR(100) NOT NULL,
  "from_state_key" VARCHAR(64),
  "from_state_label" VARCHAR(100),
  "to_state_key" VARCHAR(64) NOT NULL,
  "to_state_label" VARCHAR(100) NOT NULL,
  "actor_member_id" UUID NOT NULL,
  "record_version_before" INTEGER NOT NULL,
  "record_version_after" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "record_transition_histories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "record_transition_histories_versions"
    CHECK ("record_version_after" = "record_version_before" + 1)
);

CREATE UNIQUE INDEX "object_workflow_definitions_object_definition_id_key"
  ON "object_workflow_definitions"("object_definition_id");
CREATE UNIQUE INDEX "object_workflow_definitions_tenant_id_object_definition_id_key"
  ON "object_workflow_definitions"("tenant_id", "object_definition_id");
CREATE UNIQUE INDEX "object_workflow_definitions_tenant_id_id_key"
  ON "object_workflow_definitions"("tenant_id", "id");

CREATE UNIQUE INDEX "workflow_state_definitions_tenant_workflow_key"
  ON "workflow_state_definitions"("tenant_id", "workflow_definition_id", "key");
CREATE INDEX "workflow_state_definitions_tenant_workflow_sort_idx"
  ON "workflow_state_definitions"("tenant_id", "workflow_definition_id", "sort_order");

CREATE UNIQUE INDEX "workflow_transition_definitions_tenant_workflow_key"
  ON "workflow_transition_definitions"("tenant_id", "workflow_definition_id", "key");
CREATE UNIQUE INDEX "workflow_transition_definitions_tenant_from_to"
  ON "workflow_transition_definitions"("tenant_id", "workflow_definition_id", "from_state_key", "to_state_key");
CREATE INDEX "workflow_transition_definitions_tenant_workflow_sort_idx"
  ON "workflow_transition_definitions"("tenant_id", "workflow_definition_id", "sort_order");

CREATE INDEX "record_transition_histories_tenant_id_record_id_created_at_idx"
  ON "record_transition_histories"("tenant_id", "record_id", "created_at" DESC);

ALTER TABLE "object_workflow_definitions"
  ADD CONSTRAINT "object_workflow_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_workflow_definitions_tenant_id_object_definition_id_fkey"
  FOREIGN KEY ("tenant_id", "object_definition_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_workflow_definitions_tenant_id_created_by_member_id_fkey"
  FOREIGN KEY ("tenant_id", "created_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "object_workflow_definitions_tenant_id_updated_by_member_id_fkey"
  FOREIGN KEY ("tenant_id", "updated_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_state_definitions"
  ADD CONSTRAINT "workflow_state_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workflow_state_definitions_tenant_id_workflow_definition_id_fkey"
  FOREIGN KEY ("tenant_id", "workflow_definition_id") REFERENCES "object_workflow_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_transition_definitions"
  ADD CONSTRAINT "workflow_transition_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workflow_transition_definitions_tenant_id_workflow_definition_id_fkey"
  FOREIGN KEY ("tenant_id", "workflow_definition_id") REFERENCES "object_workflow_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "record_transition_histories"
  ADD CONSTRAINT "record_transition_histories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_transition_histories_tenant_id_object_definition_id_fkey"
  FOREIGN KEY ("tenant_id", "object_definition_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_transition_histories_tenant_id_record_id_fkey"
  FOREIGN KEY ("tenant_id", "record_id") REFERENCES "records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_transition_histories_tenant_id_object_publication_id_fkey"
  FOREIGN KEY ("tenant_id", "object_publication_id") REFERENCES "object_publications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_transition_histories_tenant_id_actor_member_id_fkey"
  FOREIGN KEY ("tenant_id", "actor_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_record_transition_history_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'record_transition_histories are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "record_transition_histories_immutable_update"
BEFORE UPDATE ON "record_transition_histories"
FOR EACH ROW EXECUTE FUNCTION "reject_record_transition_history_update"();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "object_workflow_definitions",
  "workflow_state_definitions",
  "workflow_transition_definitions"
TO crm_app;
GRANT SELECT, INSERT ON TABLE "record_transition_histories" TO crm_app;

ALTER TABLE "object_workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "object_workflow_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_state_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_state_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_transition_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_transition_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "record_transition_histories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_transition_histories" FORCE ROW LEVEL SECURITY;

CREATE POLICY "object_workflow_definitions_tenant_access" ON "object_workflow_definitions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "workflow_state_definitions_tenant_access" ON "workflow_state_definitions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "workflow_transition_definitions_tenant_access" ON "workflow_transition_definitions"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "record_transition_histories_tenant_access" ON "record_transition_histories"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
