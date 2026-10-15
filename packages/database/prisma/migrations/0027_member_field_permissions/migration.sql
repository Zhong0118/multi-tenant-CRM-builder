-- Live employee field exceptions; business records and published defaults are unchanged.
CREATE TABLE "member_field_permissions" (
  "id" uuid NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" uuid NOT NULL,
  "object_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "access" "FieldAccess" NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(3) NOT NULL,
  CONSTRAINT "member_field_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "member_field_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "member_field_permissions_tenant_id_object_id_fkey" FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "member_field_permissions_field_fkey" FOREIGN KEY ("tenant_id", "object_id", "field_id") REFERENCES "field_definitions"("tenant_id", "object_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "member_field_permissions_member_fkey" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "member_field_permissions_tenant_id_object_id_field_id_member_id_key" ON "member_field_permissions"("tenant_id", "object_id", "field_id", "member_id");
CREATE INDEX "member_field_permissions_tenant_id_object_id_member_id_idx" ON "member_field_permissions"("tenant_id", "object_id", "member_id");
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_field_permissions" TO crm_app;
ALTER TABLE "member_field_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_field_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "member_field_permissions_tenant_access" ON "member_field_permissions" TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
