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
