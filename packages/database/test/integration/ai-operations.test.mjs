import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { cleanupTestFixtures, createTestClients, migrateTestDatabase, withSettings } from "./helpers.mjs";

const tenantCodes = ["ai-operation-owner-a", "ai-operation-owner-b"];
const phones = ["+8613800002191", "+8613800002192", "+8613800002193"];
let admin;
let runtime;
let fixture;

before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  await cleanupTestFixtures(admin, { tenantCodes, phones });
  const users = await Promise.all(phones.map((phone) => admin.user.create({ data: {
    phone, displayName: phone, phoneVerifiedAt: new Date(), passwordHash: "fixture",
  } })));
  const [tenantA, tenantB] = await Promise.all(tenantCodes.map((code) => admin.tenant.create({ data: { code, name: code } })));
  const [memberA, memberOther, memberB] = await Promise.all([
    [tenantA, users[0]], [tenantA, users[1]], [tenantB, users[2]],
  ].map(([tenant, user]) => admin.tenantMember.create({ data: { tenantId: tenant.id, userId: user.id, role: "EMPLOYEE" } })));
  const conversation = await admin.aiConversation.create({ data: {
    tenantId: tenantA.id, createdByMemberId: memberA.id, title: "Pending proposal", lastMessageAt: new Date(),
  } });
  const turnId = randomUUID();
  await admin.aiMessage.create({ data: { tenantId: tenantA.id, conversationId: conversation.id, turnId, role: "USER", status: "COMPLETED", content: "write" } });
  fixture = { users, tenantA, tenantB, memberA, memberOther, memberB, conversation, turnId };
});

beforeEach(async () => {
  await admin.aiOperation.deleteMany({ where: { tenantId: fixture.tenantA.id } });
  await admin.aiConversation.update({ where: { id: fixture.conversation.id }, data: { deletedAt: null } });
  await admin.tenantMember.update({ where: { id: fixture.memberA.id }, data: { status: "ACTIVE" } });
});

after(async () => {
  if (admin) await cleanupTestFixtures(admin, { tenantCodes, phones });
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

const settings = (user, tenant) => ({ userId: user.id, tenantId: tenant.id });

async function propose() {
  const { users, tenantA, memberA, conversation, turnId } = fixture;
  return withSettings(runtime, settings(users[0], tenantA), (tx) => tx.aiOperation.create({ data: {
    tenantId: tenantA.id, conversationId: conversation.id, turnId,
    requestedByMemberId: memberA.id, operationType: "ADD_ACTIVITY_NOTE", status: "PROPOSED",
    requestText: "write a note", proposalJson: { objectCode: "demo", recordId: randomUUID(), content: "note" },
    displayChangesJson: { title: "note", changes: [] }, targetRefJson: { objectCode: "demo", recordId: randomUUID() }, expectedPublicationId: randomUUID(),
    expiresAt: new Date(Date.now() + 900_000),
  } }));
}

test("owner can read and transition own proposal, other member and tenant cannot", async () => {
  const row = await propose();
  const { users, tenantA, tenantB } = fixture;
  const owner = settings(users[0], tenantA);
  const other = settings(users[1], tenantA);
  const crossTenant = settings(users[2], tenantB);
  assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.findUnique({ where: { id: row.id } })))?.id, row.id);
  for (const unauthorized of [other, crossTenant]) {
    assert.equal(await withSettings(runtime, unauthorized, (tx) => tx.aiOperation.findUnique({ where: { id: row.id } })), null);
    assert.equal((await withSettings(runtime, unauthorized, (tx) => tx.aiOperation.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "EXECUTED" } }))).count, 0);
  }
  assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "REJECTED" } }))).count, 1);
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "REJECTED");
  await assert.rejects(() => withSettings(runtime, owner, (tx) => tx.aiOperation.delete({ where: { id: row.id } })), /permission denied|denied/i);
});

test("unset session settings cannot read or update owner operations", async () => {
  const row = await propose();
  assert.deepEqual(await runtime.aiOperation.findMany({ where: { id: row.id } }), []);
  assert.equal((await runtime.aiOperation.updateMany({ where: { id: row.id }, data: { status: "EXECUTED" } })).count, 0);
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "PROPOSED");
});

test("runtime cannot forge another member's proposal or mutate its ownership", async () => {
  const row = await propose();
  const { users, tenantA, memberA, memberOther, conversation, turnId } = fixture;
  const other = settings(users[1], tenantA);
  await assert.rejects(() => withSettings(runtime, other, (tx) => tx.aiOperation.create({ data: {
    tenantId: tenantA.id, conversationId: conversation.id, turnId: randomUUID(), requestedByMemberId: memberA.id,
    operationType: "ADD_ACTIVITY_NOTE", status: "PROPOSED", requestText: "forged",
    proposalJson: {}, displayChangesJson: {}, targetRefJson: {}, expectedPublicationId: randomUUID(), expiresAt: new Date(Date.now() + 900_000),
  } })));
  const owner = settings(users[0], tenantA);
  await assert.rejects(() => withSettings(runtime, owner, (tx) => tx.aiOperation.update({
    where: { id: row.id }, data: { requestedByMemberId: memberOther.id },
  })));
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).requestedByMemberId, memberA.id);
});

test("revoked membership cannot see or transition a pending operation", async () => {
  const row = await propose();
  const { users, tenantA, memberA } = fixture;
  await admin.tenantMember.update({ where: { id: memberA.id }, data: { status: "DISABLED" } });
  try {
    const owner = settings(users[0], tenantA);
    assert.equal(await withSettings(runtime, owner, (tx) => tx.aiOperation.findUnique({ where: { id: row.id } })), null);
    assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.updateMany({ where: { id: row.id }, data: { status: "EXECUTED" } }))).count, 0);
  } finally {
    await admin.tenantMember.update({ where: { id: memberA.id }, data: { status: "ACTIVE" } });
  }
});

test("soft-deleted conversation hides operation and forbids creation or confirmation", async () => {
  const row = await propose();
  const { users, tenantA, conversation } = fixture;
  await admin.aiConversation.update({ where: { id: conversation.id }, data: { deletedAt: new Date() } });
  const owner = settings(users[0], tenantA);
  assert.equal(await withSettings(runtime, owner, (tx) => tx.aiOperation.findUnique({ where: { id: row.id } })), null);
  assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.updateMany({ where: { id: row.id }, data: { status: "EXECUTED" } }))).count, 0);
  await assert.rejects(() => propose());
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "PROPOSED");
});

test("runtime locks operation plus owner and conversation in one transaction", async () => {
  const row = await propose();
  const { users, tenantA, memberA } = fixture;
  const locked = await withSettings(runtime, settings(users[0], tenantA), async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT o.id FROM ai_operations o
      JOIN ai_conversations c ON c.tenant_id = o.tenant_id AND c.id = o.conversation_id
      JOIN tenant_members m ON m.tenant_id = o.tenant_id AND m.id = o.requested_by_member_id
      WHERE o.tenant_id = ${tenantA.id}::uuid AND o.id = ${row.id}::uuid
        AND o.requested_by_member_id = ${memberA.id}::uuid
        AND c.created_by_member_id = ${memberA.id}::uuid AND c.deleted_at IS NULL
        AND m.user_id = ${users[0].id}::uuid AND m.status = 'ACTIVE'
      FOR UPDATE OF o, c, m
    `;
    await tx.aiOperation.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "EXPIRED" } });
    return rows;
  });
  assert.equal(locked[0]?.id, row.id);
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "EXPIRED");
});

test("expired state commits, while a failed business transaction rolls back before a conditional failure transaction", async () => {
  const row = await propose();
  const { users, tenantA, memberA } = fixture;
  const owner = settings(users[0], tenantA);
  const expired = await withSettings(runtime, owner, async (tx) => {
    const locked = await tx.$queryRaw`
      SELECT id FROM ai_operations WHERE tenant_id = ${tenantA.id}::uuid
        AND id = ${row.id}::uuid AND requested_by_member_id = ${memberA.id}::uuid FOR UPDATE
    `;
    assert.equal(locked[0]?.id, row.id);
    await tx.aiOperation.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "EXPIRED" } });
    return "EXPIRED";
  });
  assert.equal(expired, "EXPIRED");
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "EXPIRED");
  await admin.aiOperation.update({ where: { id: row.id }, data: { status: "PROPOSED" } });
  await assert.rejects(() => withSettings(runtime, owner, async (tx) => {
    await tx.aiOperation.updateMany({ where: { id: row.id, status: "PROPOSED" }, data: { status: "EXECUTED" } });
    throw new Error("business mutation rolled back");
  }), /business mutation rolled back/);
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "PROPOSED");
  assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.updateMany({
    where: { id: row.id, status: "PROPOSED", requestedByMemberId: memberA.id },
    data: { status: "FAILED", failureCode: "SAFE_BUSINESS_ERROR" },
  }))).count, 1);
  assert.equal((await withSettings(runtime, owner, (tx) => tx.aiOperation.updateMany({
    where: { id: row.id, status: "PROPOSED" }, data: { status: "EXECUTED" },
  }))).count, 0);
  assert.equal((await admin.aiOperation.findUnique({ where: { id: row.id } })).status, "FAILED");
});

test("one operation per turn regardless of terminal status", async () => {
  const row = await propose();
  await admin.aiOperation.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
  await assert.rejects(() => propose());
});
