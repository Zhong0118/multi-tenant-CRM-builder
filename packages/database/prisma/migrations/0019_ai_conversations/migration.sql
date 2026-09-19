-- Personal AI conversations and messages. Runtime role has SELECT/INSERT/UPDATE
-- only; RLS requires tenant context plus an active membership that owns the
-- conversation. Soft-delete is application-level (deleted_at); no DELETE grant.

CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TYPE "AiMessageStatus" AS ENUM (
  'GENERATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "created_by_member_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "last_message_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" UUID NOT NULL DEFAULT public.crm_uuid_v7(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "turn_id" UUID NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "status" "AiMessageStatus" NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "tool_summary" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "source_summary" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "provider_usage" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_key" VARCHAR(64),
  "model_key" VARCHAR(128),
  "error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_conversations_tenant_id_id_key"
  ON "ai_conversations"("tenant_id", "id");
CREATE INDEX "ai_conversations_tenant_id_created_by_member_id_last_message_at_id_idx"
  ON "ai_conversations"("tenant_id", "created_by_member_id", "last_message_at" DESC, "id");

CREATE UNIQUE INDEX "ai_messages_tenant_id_conversation_id_turn_id_role_key"
  ON "ai_messages"("tenant_id", "conversation_id", "turn_id", "role");
CREATE INDEX "ai_messages_tenant_id_conversation_id_created_at_id_idx"
  ON "ai_messages"("tenant_id", "conversation_id", "created_at", "id");
CREATE INDEX "ai_messages_tenant_id_status_created_at_idx"
  ON "ai_messages"("tenant_id", "status", "created_at");

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_conversations_tenant_id_created_by_member_id_fkey"
  FOREIGN KEY ("tenant_id", "created_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_messages_tenant_id_conversation_id_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "ai_conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE "ai_conversations" TO crm_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "ai_messages" TO crm_app;

CREATE POLICY "ai_conversations_owner_access"
ON "ai_conversations"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1
    FROM "tenant_members" m
    WHERE m."tenant_id" = "ai_conversations"."tenant_id"
      AND m."id" = "ai_conversations"."created_by_member_id"
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
  )
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1
    FROM "tenant_members" m
    WHERE m."tenant_id" = "ai_conversations"."tenant_id"
      AND m."id" = "ai_conversations"."created_by_member_id"
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
  )
);

CREATE POLICY "ai_messages_owner_access"
ON "ai_messages"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1
    FROM "ai_conversations" c
    JOIN "tenant_members" m
      ON m."tenant_id" = c."tenant_id"
     AND m."id" = c."created_by_member_id"
    WHERE c."tenant_id" = "ai_messages"."tenant_id"
      AND c."id" = "ai_messages"."conversation_id"
      AND c."deleted_at" IS NULL
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
  )
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1
    FROM "ai_conversations" c
    JOIN "tenant_members" m
      ON m."tenant_id" = c."tenant_id"
     AND m."id" = c."created_by_member_id"
    WHERE c."tenant_id" = "ai_messages"."tenant_id"
      AND c."id" = "ai_messages"."conversation_id"
      AND c."deleted_at" IS NULL
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND m."status" = 'ACTIVE'
  )
);
