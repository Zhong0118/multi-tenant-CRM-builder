import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const fixturePhones = ["+8613800002101", "+8613800002102", "+8613800002103"];
const fixtureTenantCodes = ["ai-tenant-a", "ai-tenant-b"];

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

test("keeps conversations isolated to the owning tenant", async () => {
  const fixture = await createAiFixture();

  const visible = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.aiConversation.findMany({
        select: { id: true, tenantId: true, createdByMemberId: true },
      }),
  );

  assert.deepEqual(visible, [
    {
      id: fixture.conversationA.id,
      tenantId: fixture.tenantA.id,
      createdByMemberId: fixture.memberA.id,
    },
  ]);
  assert.ok(!visible.some(({ tenantId }) => tenantId === fixture.tenantB.id));
});

test("keeps conversations private to the creating member in the same tenant", async () => {
  const fixture = await createAiFixture();

  const visible = await withSettings(
    runtime,
    { userId: fixture.userA2.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.aiConversation.findMany({
        select: { id: true, createdByMemberId: true },
      }),
  );

  assert.deepEqual(visible, []);
});

test("hides conversation history after the creator membership is disabled", async () => {
  const fixture = await createAiFixture();

  await admin.tenantMember.update({
    where: { id: fixture.memberA.id },
    data: { status: "DISABLED" },
  });

  const conversations = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) => tx.aiConversation.findMany({ select: { id: true } }),
  );
  const messages = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) => tx.aiMessage.findMany({ select: { id: true } }),
  );

  assert.deepEqual(conversations, []);
  assert.deepEqual(messages, []);
});

test("hides AI rows from crm_app when user and tenant settings are absent", async () => {
  await createAiFixture();

  assert.deepEqual(await runtime.aiConversation.findMany(), []);
  assert.deepEqual(await runtime.aiMessage.findMany(), []);
});

test("rejects inserting a message into another tenant or member conversation", async () => {
  const fixture = await createAiFixture();
  const turnId = randomUUID();

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA2.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.aiMessage.create({
          data: {
            tenantId: fixture.tenantA.id,
            conversationId: fixture.conversationA.id,
            turnId,
            role: "USER",
            status: "COMPLETED",
            content: "should not land on another member conversation",
          },
        }),
    ),
  );

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.aiMessage.create({
          data: {
            tenantId: fixture.tenantB.id,
            conversationId: fixture.conversationB.id,
            turnId,
            role: "USER",
            status: "COMPLETED",
            content: "should not land on another tenant conversation",
          },
        }),
    ),
  );

  const leftover = await admin.aiMessage.findMany({
    where: { turnId },
    select: { id: true },
  });
  assert.deepEqual(leftover, []);
});

test("soft-deleted conversations remain physically present but are excluded from active queries", async () => {
  const fixture = await createAiFixture();
  const deletedAt = new Date();

  await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.aiConversation.update({
        where: { id: fixture.conversationA.id },
        data: { deletedAt },
      }),
  );

  const physical = await admin.aiConversation.findUnique({
    where: { id: fixture.conversationA.id },
    select: { id: true, deletedAt: true },
  });
  assert.equal(physical.id, fixture.conversationA.id);
  assert.ok(physical.deletedAt instanceof Date);

  const active = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.aiConversation.findMany({
        where: { deletedAt: null },
        select: { id: true },
      }),
  );
  assert.deepEqual(active, []);

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.aiMessage.create({
          data: {
            tenantId: fixture.tenantA.id,
            conversationId: fixture.conversationA.id,
            turnId: randomUUID(),
            role: "USER",
            status: "COMPLETED",
            content: "must not attach to a deleted conversation",
          },
        }),
    ),
  );
});

test("denies runtime DELETE on AI conversations and messages", async () => {
  const fixture = await createAiFixture();

  await assert.rejects(
    () =>
      withSettings(
        runtime,
        { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
        (tx) =>
          tx.aiMessage.delete({
            where: { id: fixture.messageA.id },
          }),
      ),
    /permission denied|denied/i,
  );
  await assert.rejects(
    () =>
      withSettings(
        runtime,
        { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
        (tx) =>
          tx.aiConversation.delete({
            where: { id: fixture.conversationA.id },
          }),
      ),
    /permission denied|denied/i,
  );

  const stillThere = await admin.aiConversation.findUnique({
    where: { id: fixture.conversationA.id },
    select: { id: true },
  });
  assert.equal(stillThere.id, fixture.conversationA.id);
});

test("member row lock serializes delete and beginTurn so deleted+GENERATING cannot coexist", async () => {
  const fixture = await createAiFixture();
  const conversationId = fixture.conversationA.id;
  const memberId = fixture.memberA.id;
  const tenantId = fixture.tenantA.id;
  const userId = fixture.userA.id;

  const lockMember = (tx) =>
    tx.$queryRawUnsafe(
      `SELECT id FROM tenant_members
       WHERE tenant_id = $1::uuid AND id = $2::uuid AND user_id = $3::uuid AND status = 'ACTIVE'
       FOR UPDATE`,
      tenantId,
      memberId,
      userId,
    );

  const beginTurnAfterLock = async (tx) => {
    const generating = await tx.aiMessage.findFirst({
      where: {
        tenantId,
        conversationId,
        role: "ASSISTANT",
        status: "GENERATING",
      },
      select: { id: true },
    });
    if (generating) {
      throw new Error("AI_MEMBER_TURN_IN_PROGRESS");
    }
    const conversation = await tx.aiConversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!conversation) {
      throw new Error("AI_CONVERSATION_NOT_FOUND");
    }
    const turnId = randomUUID();
    await tx.aiMessage.create({
      data: {
        tenantId,
        conversationId,
        turnId,
        role: "USER",
        status: "COMPLETED",
        content: "concurrent begin",
      },
    });
    await tx.aiMessage.create({
      data: {
        tenantId,
        conversationId,
        turnId,
        role: "ASSISTANT",
        status: "GENERATING",
        content: "",
      },
    });
  };

  const removeAfterLock = async (tx) => {
    const generating = await tx.aiMessage.findFirst({
      where: {
        tenantId,
        conversationId,
        role: "ASSISTANT",
        status: "GENERATING",
      },
      select: { id: true },
    });
    if (generating) {
      throw new Error("AI_MEMBER_TURN_IN_PROGRESS");
    }
    const conversation = await tx.aiConversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!conversation) {
      throw new Error("AI_CONVERSATION_NOT_FOUND");
    }
    await tx.aiConversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
  };

  const runBothOrders = async (first, second) => {
    await admin.aiConversation.update({
      where: { id: conversationId },
      data: { deletedAt: null },
    });
    await admin.aiMessage.deleteMany({
      where: { conversationId, content: "concurrent begin" },
    });
    await admin.aiMessage.deleteMany({
      where: { conversationId, role: "ASSISTANT", status: "GENERATING" },
    });

    let releaseHold;
    const hold = new Promise((resolve) => {
      releaseHold = resolve;
    });
    let locked;
    const lockedGate = new Promise((resolve) => {
      locked = resolve;
    });

    const firstTx = withSettings(
      runtime,
      { userId, tenantId },
      async (tx) => {
        await lockMember(tx);
        locked();
        await hold;
        await first(tx);
      },
    );
    await lockedGate;
    const secondTx = withSettings(
      runtime,
      { userId, tenantId },
      async (tx) => {
        await lockMember(tx);
        await second(tx);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    releaseHold();
    const settled = await Promise.allSettled([firstTx, secondTx]);
    const conversation = await admin.aiConversation.findUnique({
      where: { id: conversationId },
      select: { deletedAt: true },
    });
    const generating = await admin.aiMessage.findMany({
      where: { conversationId, role: "ASSISTANT", status: "GENERATING" },
      select: { id: true },
    });
    assert.equal(
      Boolean(conversation.deletedAt) && generating.length > 0,
      false,
      `deleted+GENERATING coexisted; outcomes=${JSON.stringify(settled.map((item) => item.status))}`,
    );
  };

  await runBothOrders(removeAfterLock, beginTurnAfterLock);
  await runBothOrders(beginTurnAfterLock, removeAfterLock);
});

async function createAiFixture() {
  const [userA, userA2, userB] = await Promise.all([
    createUser("+8613800002101", "AI User A"),
    createUser("+8613800002102", "AI User A2"),
    createUser("+8613800002103", "AI User B"),
  ]);
  const [tenantA, tenantB] = await Promise.all([
    admin.tenant.create({ data: { name: "AI Tenant A", code: "ai-tenant-a" } }),
    admin.tenant.create({ data: { name: "AI Tenant B", code: "ai-tenant-b" } }),
  ]);
  const [memberA, memberA2, memberB] = await Promise.all([
    createMember(tenantA.id, userA.id),
    createMember(tenantA.id, userA2.id, "EMPLOYEE"),
    createMember(tenantB.id, userB.id),
  ]);
  const now = new Date();
  const [conversationA, conversationB] = await Promise.all([
    admin.aiConversation.create({
      data: {
        tenantId: tenantA.id,
        createdByMemberId: memberA.id,
        title: "Tenant A owner chat",
        lastMessageAt: now,
      },
    }),
    admin.aiConversation.create({
      data: {
        tenantId: tenantB.id,
        createdByMemberId: memberB.id,
        title: "Tenant B owner chat",
        lastMessageAt: now,
      },
    }),
  ]);
  const [messageA] = await Promise.all([
    admin.aiMessage.create({
      data: {
        tenantId: tenantA.id,
        conversationId: conversationA.id,
        turnId: randomUUID(),
        role: "USER",
        status: "COMPLETED",
        content: "hello from A",
      },
    }),
    admin.aiMessage.create({
      data: {
        tenantId: tenantB.id,
        conversationId: conversationB.id,
        turnId: randomUUID(),
        role: "USER",
        status: "COMPLETED",
        content: "hello from B",
      },
    }),
  ]);

  return {
    userA,
    userA2,
    userB,
    tenantA,
    tenantB,
    memberA,
    memberA2,
    memberB,
    conversationA,
    conversationB,
    messageA,
  };
}

function createUser(phone, displayName) {
  return admin.user.create({
    data: {
      displayName,
      phone,
      phoneVerifiedAt: new Date(),
      passwordHash: "test-password-hash",
    },
  });
}

function createMember(tenantId, userId, role = "TENANT_ADMIN") {
  return admin.tenantMember.create({
    data: {
      tenantId,
      userId,
      role,
      joinedAt: new Date(),
    },
  });
}

function cleanupFixtures() {
  return cleanupTestFixtures(admin, {
    phones: fixturePhones,
    tenantCodes: fixtureTenantCodes,
  });
}
