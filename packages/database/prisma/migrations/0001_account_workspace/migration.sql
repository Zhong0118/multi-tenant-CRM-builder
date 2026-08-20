-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('TENANT_ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('REGISTER', 'RESET_PASSWORD', 'CHANGE_PHONE');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ObjectKind" AS ENUM ('GENERIC', 'LEAD', 'OPPORTUNITY', 'CUSTOMER', 'JOURNAL');

-- CreateEnum
CREATE TYPE "ObjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'PHONE', 'EMAIL', 'NUMBER', 'MONEY', 'DATE', 'DATETIME', 'SINGLE_SELECT', 'MULTI_SELECT', 'MEMBER', 'BOOLEAN', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "FieldStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MANUAL', 'IMPORT', 'FEISHU', 'PHONE_BOT', 'API');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'INTEGRATION', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(32) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(3) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "activated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "employee_no" VARCHAR(64),
    "joined_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target_phone" VARCHAR(32) NOT NULL,
    "target_user_id" UUID,
    "role" "MemberRole" NOT NULL,
    "permission_overrides" JSONB,
    "invitation_code_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "request_ip" INET NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "ip" INET,
    "device_summary" VARCHAR(300),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "kind" "ObjectKind" NOT NULL DEFAULT 'GENERIC',
    "title_field_key" VARCHAR(64) NOT NULL,
    "icon" VARCHAR(64),
    "status" "ObjectStatus" NOT NULL DEFAULT 'DRAFT',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "source_template_version_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "object_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "field_key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "default_value" JSONB,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "FieldStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "record_no" BIGINT NOT NULL,
    "owner_member_id" UUID,
    "status_key" VARCHAR(64),
    "title" VARCHAR(300) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "created_by_member_id" UUID,
    "created_by_integration_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" VARCHAR(100) NOT NULL,
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "tenant_members_tenant_id_status_idx" ON "tenant_members"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_user_id_key" ON "tenant_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_id_key" ON "tenant_members"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_employee_no_key" ON "tenant_members"("tenant_id", "employee_no");

-- CreateIndex
CREATE INDEX "tenant_invitations_tenant_id_target_phone_status_idx" ON "tenant_invitations"("tenant_id", "target_phone", "status");

-- CreateIndex
CREATE INDEX "tenant_invitations_target_user_id_status_idx" ON "tenant_invitations"("target_user_id", "status");

-- CreateIndex
CREATE INDEX "verification_challenges_phone_purpose_created_at_idx" ON "verification_challenges"("phone", "purpose", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "object_definitions_tenant_id_status_idx" ON "object_definitions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "object_definitions_tenant_id_code_key" ON "object_definitions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "object_definitions_tenant_id_id_key" ON "object_definitions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "field_definitions_tenant_id_object_id_status_sort_order_idx" ON "field_definitions"("tenant_id", "object_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_tenant_id_object_id_field_key_key" ON "field_definitions"("tenant_id", "object_id", "field_key");

-- CreateIndex
CREATE INDEX "records_tenant_id_object_id_deleted_at_updated_at_idx" ON "records"("tenant_id", "object_id", "deleted_at", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "records_tenant_id_object_id_owner_member_id_deleted_at_upda_idx" ON "records"("tenant_id", "object_id", "owner_member_id", "deleted_at", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "records_tenant_id_object_id_status_key_deleted_at_idx" ON "records"("tenant_id", "object_id", "status_key", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "records_tenant_id_object_id_record_no_key" ON "records"("tenant_id", "object_id", "record_no");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_definitions" ADD CONSTRAINT "object_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_tenant_id_object_id_fkey" FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_tenant_id_object_id_fkey" FOREIGN KEY ("tenant_id", "object_id") REFERENCES "object_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_tenant_id_owner_member_id_fkey" FOREIGN KEY ("tenant_id", "owner_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records" ADD CONSTRAINT "records_tenant_id_created_by_member_id_fkey" FOREIGN KEY ("tenant_id", "created_by_member_id") REFERENCES "tenant_members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one pending invitation may exist for a phone number in a tenant.
CREATE UNIQUE INDEX "tenant_invitations_one_pending_phone"
ON "tenant_invitations" ("tenant_id", "target_phone")
WHERE "status" = 'PENDING';

-- The application role can use the schema and identity tables, but audit rows
-- remain append-only. Tenant tables are further restricted by RLS below.
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "users",
  "tenants",
  "tenant_members",
  "tenant_invitations",
  "verification_challenges",
  "sessions",
  "object_definitions",
  "field_definitions",
  "records"
TO crm_app;
GRANT SELECT, INSERT ON TABLE "audit_logs" TO crm_app;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "object_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "object_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenants_member_select" ON "tenants"
FOR SELECT TO crm_app
USING (
  "id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR EXISTS (
    SELECT 1
    FROM "tenant_members"
    WHERE "tenant_members"."tenant_id" = "tenants"."id"
      AND "tenant_members"."user_id" = NULLIF(current_setting('app.user_id'), '')::uuid
      AND "tenant_members"."status" = 'ACTIVE'
  )
);

CREATE POLICY "tenants_platform_access" ON "tenants"
TO crm_app
USING (
  EXISTS (
    SELECT 1 FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id'), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "users"
    WHERE "users"."id" = NULLIF(current_setting('app.user_id'), '')::uuid
      AND "users"."is_platform_admin" = true
      AND "users"."status" = 'ACTIVE'
  )
);

CREATE POLICY "tenant_members_self_select" ON "tenant_members"
FOR SELECT TO crm_app
USING ("user_id" = NULLIF(current_setting('app.user_id'), '')::uuid);

CREATE POLICY "tenant_members_tenant_access" ON "tenant_members"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "tenant_invitations_self_select" ON "tenant_invitations"
FOR SELECT TO crm_app
USING (
  "target_user_id" = NULLIF(current_setting('app.user_id'), '')::uuid
);

CREATE POLICY "tenant_invitations_self_update" ON "tenant_invitations"
FOR UPDATE TO crm_app
USING (
  "target_user_id" = NULLIF(current_setting('app.user_id'), '')::uuid
)
WITH CHECK (
  "target_user_id" = NULLIF(current_setting('app.user_id'), '')::uuid
);

CREATE POLICY "tenant_invitations_tenant_access" ON "tenant_invitations"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "object_definitions_tenant_access" ON "object_definitions"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "field_definitions_tenant_access" ON "field_definitions"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "records_tenant_access" ON "records"
TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "audit_logs_tenant_select" ON "audit_logs"
FOR SELECT TO crm_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "audit_logs_tenant_insert" ON "audit_logs"
FOR INSERT TO crm_app
WITH CHECK (
  "tenant_id" IS NULL
  OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);
