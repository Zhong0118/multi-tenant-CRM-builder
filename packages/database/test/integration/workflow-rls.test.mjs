import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const fixturePhones = ["+8613800001101", "+8613800001102"];
const fixtureTenantCodes = ["workflow-a", "workflow-b"];

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

test("keeps workflow drafts isolated to the current tenant", async () => {
  const fixture = await createWorkflowFixture();

  assert.deepEqual(await runtime.objectWorkflowDefinition.findMany(), []);

  const visible = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.objectWorkflowDefinition.findMany({
        select: { tenantId: true, objectDefinitionId: true },
      }),
  );

  assert.deepEqual(visible, [
    {
      tenantId: fixture.tenantA.id,
      objectDefinitionId: fixture.objectA.id,
    },
  ]);
  assert.ok(
    !visible.some(({ tenantId }) => tenantId === fixture.tenantB.id),
  );
});

test("keeps transition history isolated to the current tenant", async () => {
  const fixture = await createWorkflowFixture();

  const visible = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.recordTransitionHistory.findMany({
        select: { tenantId: true, recordId: true, transitionKey: true },
      }),
  );

  assert.deepEqual(visible, [
    {
      tenantId: fixture.tenantA.id,
      recordId: fixture.recordA.id,
      transitionKey: "__start__",
    },
  ]);
  assert.ok(
    !visible.some(({ tenantId }) => tenantId === fixture.tenantB.id),
  );
});

test("keeps transition history append-only for the runtime role", async () => {
  const fixture = await createWorkflowFixture();

  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.recordTransitionHistory.update({
          where: { id: fixture.historyA.id },
          data: { transitionLabel: "must not change" },
        }),
    ),
  );
  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.recordTransitionHistory.delete({
          where: { id: fixture.historyA.id },
        }),
    ),
  );
});

async function createWorkflowFixture() {
  const [userA, userB] = await Promise.all([
    createUser("+8613800001101", "流程管理员 A"),
    createUser("+8613800001102", "流程管理员 B"),
  ]);
  const [tenantA, tenantB] = await Promise.all([
    admin.tenant.create({ data: { name: "流程租户 A", code: "workflow-a" } }),
    admin.tenant.create({ data: { name: "流程租户 B", code: "workflow-b" } }),
  ]);
  const [memberA, memberB] = await Promise.all([
    createMember(tenantA.id, userA.id),
    createMember(tenantB.id, userB.id),
  ]);
  const [objectA, objectB] = await Promise.all([
    createObject(tenantA.id, "cases-a"),
    createObject(tenantB.id, "cases-b"),
  ]);
  const [recordA] = await Promise.all([
    createRecord(tenantA.id, objectA.id, memberA.id, "记录 A"),
    createRecord(tenantB.id, objectB.id, memberB.id, "记录 B"),
  ]);
  const [publicationA, publicationB] = await Promise.all([
    createPublication(tenantA.id, objectA.id, memberA.id),
    createPublication(tenantB.id, objectB.id, memberB.id),
  ]);
  const [workflowA, workflowB] = await Promise.all([
    createWorkflow(tenantA.id, objectA.id, memberA.id),
    createWorkflow(tenantB.id, objectB.id, memberB.id),
  ]);
  const [historyA] = await Promise.all([
    createHistory({
      tenantId: tenantA.id,
      objectId: objectA.id,
      recordId: recordA.id,
      publicationId: publicationA.id,
      actorMemberId: memberA.id,
    }),
    createHistory({
      tenantId: tenantB.id,
      objectId: objectB.id,
      recordId: (
        await admin.record.findFirstOrThrow({
          where: { tenantId: tenantB.id },
        })
      ).id,
      publicationId: publicationB.id,
      actorMemberId: memberB.id,
    }),
  ]);

  return {
    historyA,
    objectA,
    recordA,
    tenantA,
    tenantB,
    userA,
    workflowA,
    workflowB,
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

function createMember(tenantId, userId) {
  return admin.tenantMember.create({
    data: {
      tenantId,
      userId,
      role: "TENANT_ADMIN",
      joinedAt: new Date(),
    },
  });
}

function createObject(tenantId, code) {
  return admin.objectDefinition.create({
    data: {
      tenantId,
      name: code,
      code,
      titleFieldKey: "name",
    },
  });
}

function createRecord(tenantId, objectId, memberId, title) {
  return admin.record.create({
    data: {
      tenantId,
      objectId,
      recordNo: 1n,
      ownerMemberId: memberId,
      title,
      data: { name: title },
      source: "MANUAL",
      createdByMemberId: memberId,
    },
  });
}

function createPublication(tenantId, objectId, memberId) {
  return admin.objectPublication.create({
    data: {
      tenantId,
      objectId,
      publicationNo: 1,
      sourceDraftVersion: 1,
      configuration: {
        object: { id: objectId, code: "cases", titleFieldKey: "name" },
        fields: [],
      },
      changeSummary: { changes: [] },
      publishedByMemberId: memberId,
    },
  });
}

function createWorkflow(tenantId, objectDefinitionId, memberId) {
  return admin.objectWorkflowDefinition.create({
    data: {
      tenantId,
      objectDefinitionId,
      isEnabled: true,
      initialStateKey: "new",
      createdByMemberId: memberId,
      updatedByMemberId: memberId,
      states: {
        create: [
          {
            key: "new",
            label: "新建",
            sortOrder: 10,
            isTerminal: false,
          },
        ],
      },
      transitions: {
        create: [
          {
            key: "start-following",
            label: "开始跟进",
            fromStateKey: "new",
            toStateKey: "following",
            allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
            requiredFieldKeys: [],
            sortOrder: 10,
          },
        ],
      },
    },
  });
}

function createHistory(input) {
  return admin.recordTransitionHistory.create({
    data: {
      tenantId: input.tenantId,
      objectDefinitionId: input.objectId,
      recordId: input.recordId,
      objectPublicationId: input.publicationId,
      transitionKey: "__start__",
      transitionLabel: "进入流程",
      fromStateKey: null,
      fromStateLabel: null,
      toStateKey: "new",
      toStateLabel: "新建",
      actorMemberId: input.actorMemberId,
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    },
  });
}

function cleanupFixtures() {
  return cleanupTestFixtures(admin, {
    phones: fixturePhones,
    tenantCodes: fixtureTenantCodes,
  });
}
