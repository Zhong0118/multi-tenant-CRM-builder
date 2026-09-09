-- Generate RFC 9562 UUIDv7 on PostgreSQL 15+ without an extension.
-- The first 48 bits hold Unix milliseconds; the remaining bits retain
-- gen_random_uuid() entropy and its RFC variant, replacing only the version.
-- No existing ID changes; this also covers INSERTs outside Prisma.
CREATE FUNCTION public.crm_uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
          || '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14))::uuid;
$$;

ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "tenants" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "tenant_dashboard_configurations" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "tenant_dashboard_publications" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "tenant_members" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "tenant_invitations" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "verification_challenges" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "sessions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "object_definitions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "business_templates" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "business_template_versions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "business_template_applications" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "field_definitions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "object_publications" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "view_definitions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "object_permissions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "field_permissions" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "records" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "record_activities" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
ALTER TABLE "record_follow_ups" ALTER COLUMN "id" SET DEFAULT public.crm_uuid_v7();
