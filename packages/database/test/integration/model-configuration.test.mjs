import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  migrateTestDatabase,
  createTestClients,
  withSettings,
} from "./helpers.mjs";

let admin, runtime, platform, company, staff, member;
const asPlatform = (work) =>
  withSettings(runtime, { userId: platform.id }, work);
const asMember = (work) =>
  withSettings(runtime, { userId: staff.id, tenantId: company.id }, work);
const q = (tx, sql, ...args) => tx.$queryRawUnsafe(sql, ...args);
before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  const phone = () => "+86" + String(Math.random()).slice(2, 13);
  platform = await admin.user.create({
    data: {
      phone: phone(),
      phoneVerifiedAt: new Date(),
      displayName: "model manager",
      passwordHash: "fixture",
      isPlatformAdmin: true,
    },
  });
  staff = await admin.user.create({
    data: {
      phone: phone(),
      phoneVerifiedAt: new Date(),
      displayName: "model member",
      passwordHash: "fixture",
    },
  });
  company = await admin.tenant.create({
    data: {
      code: randomUUID().slice(0, 20),
      name: "model DB test",
      status: "ACTIVE",
    },
  });
  member = await admin.tenantMember.create({
    data: { tenantId: company.id, userId: staff.id, role: "TENANT_ADMIN" },
  });
});
after(async () => {
  if (member) await admin.tenantMember.delete({ where: { id: member.id } });
  if (company) await admin.tenant.delete({ where: { id: company.id } });
  if (platform && staff)
    await admin.user.deleteMany({
      where: { id: { in: [platform.id, staff.id] } },
    });
  await runtime?.$disconnect();
  await admin?.$disconnect();
});
test("runtime and platform sessions cannot SELECT envelope rows; only administrators can read test history", async () => {
  for (const session of [asMember, asPlatform]) {
    await assert.rejects(
      session((tx) => q(tx, "SELECT * FROM ai_model_credentials")),
      /permission denied/i,
    );
  }
  const [provider] = await asPlatform((tx) =>
    q(
      tx,
      "INSERT INTO ai_model_providers(name,preset) VALUES ('DB proof','custom') RETURNING id",
    ),
  );
  try {
    assert.equal(
      (
        await asMember((tx) =>
          q(
            tx,
            "SELECT id FROM ai_model_providers WHERE id=$1::uuid",
            provider.id,
          ),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await asPlatform((tx) =>
          q(
            tx,
            "SELECT id FROM ai_model_providers WHERE id=$1::uuid",
            provider.id,
          ),
        )
      ).length,
      1,
    );
    assert.deepEqual(
      await asMember((tx) => q(tx, "SELECT * FROM ai_model_tests")),
      [],
    );
    assert.deepEqual(
      await asMember((tx) =>
        q(
          tx,
          "SELECT * FROM ai_resolve_model($1::uuid,$2::uuid,'embedding',ARRAY[]::text[])",
          company.id,
          member.id,
        ),
      ),
      [],
    );
  } finally {
    await asPlatform((tx) =>
      tx.$executeRawUnsafe(
        "DELETE FROM ai_model_providers WHERE id=$1::uuid",
        provider.id,
      ),
    );
  }
});
