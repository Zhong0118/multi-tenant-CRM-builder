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
