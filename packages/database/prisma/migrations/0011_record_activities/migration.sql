-- Append-only record activities. Members may insert notes, calls, messages
-- and meetings; updates are rejected so history cannot be overwritten.

CREATE TYPE "RecordActivityType" AS ENUM (
  'CALL',
  'MESSAGE',
  'MEETING',
  'NOTE',
  'STATUS_CHANGE',
  'SYSTEM'
);

CREATE UNIQUE INDEX "records_tenant_id_id_key" ON "records"("tenant_id", "id");

CREATE TABLE "record_activities" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "record_id" UUID NOT NULL,
  "activity_type" "RecordActivityType" NOT NULL,
  "content" TEXT NOT NULL,
  "result_key" VARCHAR(64),
  "next_action_at" TIMESTAMPTZ(3),
  "actor_member_id" UUID,
  "actor_integration_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "record_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "record_activities_content_not_blank" CHECK (char_length(btrim("content")) > 0),
  CONSTRAINT "record_activities_actor_shape" CHECK (
    ("actor_member_id" IS NOT NULL AND "actor_integration_id" IS NULL)
    OR
    ("actor_member_id" IS NULL AND "actor_integration_id" IS NOT NULL)
  )
);

CREATE INDEX "record_activities_tenant_id_record_id_created_at_idx"
ON "record_activities"("tenant_id", "record_id", "created_at" DESC);

ALTER TABLE "record_activities"
  ADD CONSTRAINT "record_activities_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_activities_tenant_id_record_id_fkey"
  FOREIGN KEY ("tenant_id", "record_id") REFERENCES "records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "record_activities_tenant_id_actor_member_id_fkey"
  FOREIGN KEY ("tenant_id", "actor_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_record_activity_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'record_activities are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "record_activities_immutable_update"
BEFORE UPDATE ON "record_activities"
FOR EACH ROW EXECUTE FUNCTION "reject_record_activity_update"();

GRANT SELECT, INSERT ON TABLE "record_activities" TO crm_app;

ALTER TABLE "record_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_activities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "record_activities_tenant_access" ON "record_activities"
TO crm_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
