import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("./prisma/schema.prisma", import.meta.url);

test("defines the core multi-tenant CRM models", async () => {
  const schema = await readFile(schemaUrl, "utf8");
  const models = [
    "User",
    "Tenant",
    "TenantMember",
    "TenantInvitation",
    "VerificationChallenge",
    "Session",
    "ObjectDefinition",
    "FieldDefinition",
    "ObjectPublication",
    "ViewDefinition",
    "ObjectPermission",
    "FieldPermission",
    "RecordCounter",
    "Record",
  ];

  for (const model of models) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`));
  }

  assert.match(
    schema,
    /model\s+Record[\s\S]*tenantId\s+String\s+@map\("tenant_id"\)/,
  );
  assert.match(schema, /data\s+Json\s+@default\("\{\}"\)\s+@db\.JsonB/);
});

test("defines tenant dashboard drafts and immutable publications", async () => {
  const schema = await readFile(schemaUrl, "utf8");

  assert.match(
    schema,
    /model\s+TenantDashboardConfiguration\s+\{[\s\S]*?draftVersion\s+Int\s+@default\(1\)\s+@map\("version"\)[\s\S]*?draftConfiguration\s+Json\s+@map\("configuration"\)\s+@db\.JsonB[\s\S]*?activePublicationId\s+String\?\s+@map\("active_publication_id"\)\s+@db\.Uuid[\s\S]*?sourceTemplateVersionId\s+String\?\s+@map\("source_template_version_id"\)\s+@db\.Uuid[\s\S]*?publications\s+TenantDashboardPublication\[\]/,
  );
  assert.match(schema, /model\s+TenantDashboardPublication\s+\{/);
  assert.match(
    schema,
    /model\s+TenantDashboardPublication\s+\{[\s\S]*?publicationNo\s+Int\s+@map\("publication_no"\)[\s\S]*?sourceDraftVersion\s+Int\s+@map\("source_draft_version"\)[\s\S]*?configuration\s+Json\s+@db\.JsonB[\s\S]*?publishedByMemberId\s+String\?\s+@map\("published_by_member_id"\)\s+@db\.Uuid[\s\S]*?publisher\s+TenantMember\?\s+@relation\("TenantDashboardPublicationPublisher",\s*fields:\s*\[tenantId,\s*publishedByMemberId\],\s*references:\s*\[tenantId,\s*id\],\s*onDelete:\s*Restrict\)[\s\S]*?@@unique\(\[tenantId,\s*publicationNo\]\)/,
  );
});

test("separates migration and runtime database credentials", async () => {
  const env = await readFile(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  );
  const prismaConfig = await readFile(
    new URL("./prisma.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(env, /^DATABASE_ADMIN_URL=/m);
  assert.match(env, /^DATABASE_URL=/m);
  assert.match(prismaConfig, /DATABASE_ADMIN_URL/);
});

test("defines append-only audit and tenant RLS", async () => {
  const schema = await readFile(schemaUrl, "utf8");

  assert.match(schema, /model AuditLog \{/);
  assert.match(schema, /enum AuditActorType \{/);

  const migration = await readFile(
    new URL(
      "./prisma/migrations/0001_account_workspace/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /CREATE UNIQUE INDEX.*tenant_invitations.*PENDING/is);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.tenant_id'/);
});

test("allows a verified user to discover invitations sent before registration", async () => {
  const migration = await readFile(
    new URL(
      "./prisma/migrations/0002_invitation_phone_access/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /target_phone/);
  assert.match(migration, /users.*phone/is);
  assert.match(migration, /current_setting\('app\.user_id', true\)/);
});
