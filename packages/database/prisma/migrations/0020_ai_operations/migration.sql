-- Durable one-per-turn proposals. crm_app cannot delete operation history.
CREATE TYPE "AiOperationType" AS ENUM ('UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE');
CREATE TYPE "AiOperationStatus" AS ENUM ('PROPOSED', 'REJECTED', 'EXPIRED', 'CONFLICTED', 'FAILED', 'EXECUTED');

CREATE TABLE "ai_operations" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "turn_id" UUID NOT NULL,
  "requested_by_member_id" UUID NOT NULL,
  "confirmed_by_member_id" UUID,
  "operation_type" "AiOperationType" NOT NULL,
  "status" "AiOperationStatus" NOT NULL DEFAULT 'PROPOSED',
  "request_text" TEXT NOT NULL,
  "proposal_json" JSONB NOT NULL,
  "display_changes_json" JSONB NOT NULL,
  "target_ref_json" JSONB NOT NULL,
  "expected_version" INTEGER,
  "expected_publication_id" UUID NOT NULL,
  "result_json" JSONB,
  "audit_id" UUID,
  "failure_code" VARCHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "executed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_operations_proposal_object" CHECK (jsonb_typeof("proposal_json") = 'object'),
  CONSTRAINT "ai_operations_display_object" CHECK (jsonb_typeof("display_changes_json") = 'object'),
  CONSTRAINT "ai_operations_target_object" CHECK (jsonb_typeof("target_ref_json") = 'object')
);

CREATE UNIQUE INDEX "ai_operations_tenant_id_id_key" ON "ai_operations"("tenant_id", "id");
CREATE UNIQUE INDEX "ai_operations_tenant_id_conversation_id_turn_id_key" ON "ai_operations"("tenant_id", "conversation_id", "turn_id");
CREATE INDEX "ai_operations_tenant_id_requested_by_member_id_conversation_id_created_at_idx" ON "ai_operations"("tenant_id", "requested_by_member_id", "conversation_id", "created_at" DESC);
CREATE INDEX "ai_operations_tenant_id_status_expires_at_idx" ON "ai_operations"("tenant_id", "status", "expires_at");

ALTER TABLE "ai_operations"
  ADD CONSTRAINT "ai_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_operations_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "ai_conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_operations_tenant_id_requested_by_member_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_operations_tenant_id_confirmed_by_member_id_fkey" FOREIGN KEY ("tenant_id", "confirmed_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_operations" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE "ai_operations" TO crm_app;

CREATE POLICY "ai_operations_owner_access" ON "ai_operations" TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM "ai_conversations" c
    JOIN "tenant_members" m ON m."tenant_id" = c."tenant_id" AND m."id" = c."created_by_member_id"
    WHERE c."tenant_id" = "ai_operations"."tenant_id"
      AND c."id" = "ai_operations"."conversation_id"
      AND c."deleted_at" IS NULL
      AND c."created_by_member_id" = "ai_operations"."requested_by_member_id"
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
  )
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM "ai_conversations" c
    JOIN "tenant_members" m ON m."tenant_id" = c."tenant_id" AND m."id" = c."created_by_member_id"
    WHERE c."tenant_id" = "ai_operations"."tenant_id"
      AND c."id" = "ai_operations"."conversation_id"
      AND c."deleted_at" IS NULL
      AND c."created_by_member_id" = "ai_operations"."requested_by_member_id"
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
      AND ("ai_operations"."confirmed_by_member_id" IS NULL OR "ai_operations"."confirmed_by_member_id" = m."id")
  )
);
