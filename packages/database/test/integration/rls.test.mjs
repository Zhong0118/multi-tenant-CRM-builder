import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  createTestClients,
  migrateTestDatabase,
  resetTestData,
  withSettings,
} from "./helpers.mjs";

let admin;
let runtime;

before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});

beforeEach(async () => {
  await resetTestData(admin);
});

after(async () => {
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

async function createIsolationFixture() {
  const [userA, userB] = await Promise.all([
    admin.user.create({
      data: {
        displayName: "User A",
        phone: "+8613800000001",
        phoneVerifiedAt: new Date(),
        passwordHash: "test-password-hash",
      },
    }),
    admin.user.create({
      data: {
        displayName: "User B",
        phone: "+8613800000002",
        phoneVerifiedAt: new Date(),
        passwordHash: "test-password-hash",
      },
    }),
  ]);
  const [tenantA, tenantB] = await Promise.all([
    admin.tenant.create({ data: { name: "Tenant A", code: "tenant-a" } }),
    admin.tenant.create({ data: { name: "Tenant B", code: "tenant-b" } }),
  ]);
  const [memberA, memberB] = await Promise.all([
    admin.tenantMember.create({
      data: {
        tenantId: tenantA.id,
        userId: userA.id,
        role: "TENANT_ADMIN",
        joinedAt: new Date(),
      },
    }),
    admin.tenantMember.create({
      data: {
        tenantId: tenantB.id,
        userId: userB.id,
        role: "TENANT_ADMIN",
        joinedAt: new Date(),
      },
    }),
  ]);

  await Promise.all([
    admin.tenantInvitation.create({
      data: {
        tenantId: tenantA.id,
        targetPhone: userA.phone,
        targetUserId: userA.id,
        role: "EMPLOYEE",
        invitationCodeHash: "invite-a",
        createdByUserId: userA.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    }),
    admin.tenantInvitation.create({
      data: {
        tenantId: tenantB.id,
        targetPhone: userB.phone,
        targetUserId: userB.id,
        role: "EMPLOYEE",
        invitationCodeHash: "invite-b",
        createdByUserId: userB.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    }),
  ]);

  return { memberB, tenantA, tenantB, userA };
}

test("requires user context and exposes only the user's own membership", async () => {
  const { tenantA, userA } = await createIsolationFixture();

  await assert.rejects(() => runtime.tenantMember.findMany());

  const memberships = await withSettings(runtime, { userId: userA.id }, (tx) =>
    tx.tenantMember.findMany({
      orderBy: { tenantId: "asc" },
      select: { tenantId: true },
    }),
  );

  assert.deepEqual(memberships, [{ tenantId: tenantA.id }]);
});

test("prevents cross-tenant invitation reads and member mutations", async () => {
  const { memberB, tenantA, tenantB, userA } =
    await createIsolationFixture();

  const invitations = await withSettings(runtime, { userId: userA.id }, (tx) =>
    tx.tenantInvitation.findMany({ select: { tenantId: true } }),
  );

  assert.deepEqual(invitations, [{ tenantId: tenantA.id }]);
  assert.ok(!invitations.some(({ tenantId }) => tenantId === tenantB.id));

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: userA.id, tenantId: tenantA.id },
      (tx) =>
        tx.tenantMember.update({
          where: { id: memberB.id },
          data: { status: "DISABLED" },
        }),
    ),
  );
});

test("keeps audit rows append-only for the runtime role", async () => {
  const { tenantA, userA } = await createIsolationFixture();
  const audit = await admin.auditLog.create({
    data: {
      tenantId: tenantA.id,
      actorType: "USER",
      actorId: userA.id,
      action: "member.created",
      resourceType: "tenant_member",
      resourceId: userA.id,
      requestId: "req_rls_test",
    },
  });

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: userA.id, tenantId: tenantA.id },
      (tx) =>
        tx.auditLog.update({
          where: { id: audit.id },
          data: { reason: "must not change" },
        }),
    ),
  );
  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: userA.id, tenantId: tenantA.id },
      (tx) => tx.auditLog.delete({ where: { id: audit.id } }),
    ),
  );
});

test("allows only one concurrent pending invitation per tenant and phone", async () => {
  const { tenantA, userA } = await createIsolationFixture();
  await admin.tenantInvitation.deleteMany({
    where: { tenantId: tenantA.id, targetPhone: userA.phone },
  });

  const invitation = (invitationCodeHash) => ({
    tenantId: tenantA.id,
    targetPhone: userA.phone,
    targetUserId: userA.id,
    role: "EMPLOYEE",
    invitationCodeHash,
    createdByUserId: userA.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const results = await Promise.allSettled([
    admin.tenantInvitation.create({ data: invitation("concurrent-a") }),
    admin.tenantInvitation.create({ data: invitation("concurrent-b") }),
  ]);

  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);

  await admin.tenantInvitation.create({
    data: { ...invitation("accepted-invite"), status: "ACCEPTED" },
  });
});
