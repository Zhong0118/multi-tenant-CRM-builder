import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const fixturePhones = [
  "+8613900000201",
  "+8613900000202",
  "+8613900000203",
  "+8613900000204",
];
const fixtureTemplateCodes = [
  "sales-access",
  "sales-inactive",
  "sales-immutable",
];
const fixtureTenantCode = "template-source-company";

let admin;
let runtime;

before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});

beforeEach(async () => {
  await cleanupFixtures();
});

afterEach(async () => {
  await cleanupFixtures();
});

after(async () => {
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

test("platform template rows require an active platform administrator", async () => {
  const platform = await createUser("+8613900000201", true);
  const regular = await createUser("+8613900000202", false);
  const inactivePlatform = await createUser("+8613900000204", true, "DISABLED");
  const templateId = randomUUID();

  await assert.rejects(() =>
    withSettings(runtime, { userId: regular.id }, (tx) =>
      tx.$executeRawUnsafe(
        "INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())",
        templateId,
        "sales-access",
        "销售模板",
        JSON.stringify({ schemaVersion: 1, objects: [] }),
        platform.id,
      ),
    ),
  );

  await assert.rejects(() =>
    withSettings(runtime, { userId: inactivePlatform.id }, (tx) =>
      tx.$executeRawUnsafe(
        "INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())",
        randomUUID(),
        "sales-inactive",
        "销售模板",
        JSON.stringify({ schemaVersion: 1, objects: [] }),
        platform.id,
      ),
    ),
  );

  await withSettings(runtime, { userId: platform.id }, (tx) =>
    tx.$executeRawUnsafe(
      "INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())",
      templateId,
      "sales-access",
      "销售模板",
      JSON.stringify({ schemaVersion: 1, objects: [] }),
      platform.id,
    ),
  );
});

test("published template versions and applications reject runtime mutations", async () => {
  const platform = await createUser("+8613900000203", true);
  const templateId = randomUUID();
  const versionId = randomUUID();

  await withSettings(runtime, { userId: platform.id }, async (tx) => {
    await tx.$executeRawUnsafe(
      "INSERT INTO business_templates (id, code, name, draft_configuration, created_by_user_id, updated_at) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, now())",
      templateId,
      "sales-immutable",
      "销售模板",
      JSON.stringify({ schemaVersion: 1, objects: [] }),
      platform.id,
    );
    await tx.$executeRawUnsafe(
      "INSERT INTO business_template_versions (id, template_id, version_no, source_draft_version, schema_version, configuration, configuration_checksum, change_summary, published_by_user_id) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::uuid)",
      versionId,
      templateId,
      1,
      1,
      1,
      JSON.stringify({ schemaVersion: 1, objects: [] }),
      "0".repeat(64),
      JSON.stringify({ objects: [] }),
      platform.id,
    );
  });

  await assert.rejects(() =>
    admin.$executeRawUnsafe(
      "UPDATE business_template_versions SET version_no = 2 WHERE id = $1::uuid",
      versionId,
    ),
  );
  await assert.rejects(() =>
    withSettings(runtime, { userId: platform.id }, (tx) =>
      tx.$executeRawUnsafe(
        "UPDATE business_template_versions SET version_no = 2 WHERE id = $1::uuid",
        versionId,
      ),
    ),
  );
  await assert.rejects(() =>
    withSettings(runtime, { userId: platform.id }, (tx) =>
      tx.$executeRawUnsafe(
        "DELETE FROM business_template_versions WHERE id = $1::uuid",
        versionId,
      ),
    ),
  );
  await assert.rejects(() =>
    withSettings(runtime, { userId: platform.id }, (tx) =>
      tx.businessTemplateVersion.update({
        where: { id: versionId },
        data: { configuration: { schemaVersion: 1, objects: [] } },
      }),
    ),
  );
  await assert.rejects(() =>
    withSettings(runtime, { userId: platform.id }, (tx) =>
      tx.$executeRawUnsafe(
        "UPDATE business_template_applications SET object_id_map = '{}'::jsonb WHERE id = $1::uuid",
        randomUUID(),
      ),
    ),
  );

  const tenant = await admin.tenant.create({
    data: {
      name: "模板来源测试公司",
      code: fixtureTenantCode,
      status: "DRAFT",
    },
  });
  await admin.objectDefinition.createMany({
    data: [
      {
        tenantId: tenant.id,
        code: "customers",
        name: "客户",
        titleFieldKey: "name",
        sortOrder: 10,
        sourceTemplateVersionId: versionId,
      },
      {
        tenantId: tenant.id,
        code: "opportunities",
        name: "商机",
        titleFieldKey: "name",
        sortOrder: 20,
        sourceTemplateVersionId: versionId,
      },
    ],
  });

  const sourced = await admin.objectDefinition.findMany({
    where: { sourceTemplateVersionId: versionId },
  });
  assert.equal(sourced.length, 2);
});

test("published template tables allow only select and insert RLS policies", async () => {
  const policies = await admin.$queryRawUnsafe(
    "SELECT tablename, cmd FROM pg_policies WHERE schemaname = current_schema() AND tablename IN ('business_template_versions', 'business_template_applications') ORDER BY tablename, cmd",
  );

  assert.deepEqual(policies, [
    { tablename: "business_template_applications", cmd: "INSERT" },
    { tablename: "business_template_applications", cmd: "SELECT" },
    { tablename: "business_template_versions", cmd: "INSERT" },
    { tablename: "business_template_versions", cmd: "SELECT" },
  ]);
});

function createUser(phone, isPlatformAdmin, status = "ACTIVE") {
  return admin.user.create({
    data: {
      displayName: phone,
      phone,
      phoneVerifiedAt: new Date(),
      passwordHash: "test-password-hash",
      isPlatformAdmin,
      status,
    },
  });
}

async function cleanupFixtures() {
  await cleanupTestFixtures(admin, {
    phones: fixturePhones,
    tenantCodes: [fixtureTenantCode],
    templateCodes: fixtureTemplateCodes,
  });
}
