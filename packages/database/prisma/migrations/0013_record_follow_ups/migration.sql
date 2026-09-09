CREATE TABLE "record_follow_ups" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "record_id" UUID NOT NULL,
  "assignee_member_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL CHECK (char_length(btrim("title")) > 0),
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','DONE','CANCELLED')),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenant_id", "record_id") REFERENCES "records"("tenant_id", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("tenant_id", "assignee_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "record_follow_ups_tenant_id_assignee_member_id_status_due_at_idx"
  ON "record_follow_ups"("tenant_id", "assignee_member_id", "status", "due_at");
GRANT SELECT, INSERT, UPDATE ON "record_follow_ups" TO crm_app;
ALTER TABLE "record_follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_follow_ups" FORCE ROW LEVEL SECURITY;
CREATE POLICY "record_follow_ups_tenant_access" ON "record_follow_ups" TO crm_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
