import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const fixturePhones = ["+8613800001201"];
const fixtureTenantCodes = ["workflow-actions"];

const orderedActions = [
  {
    key: "record-won",
    type: "UPDATE_RECORD",
    target: "SOURCE_RECORD",
    values: { stage: { source: "LITERAL", value: "won" } },
  },
  {
    key: "assign-actor",
    type: "ASSIGN_OWNER",
    target: "SOURCE_RECORD",
    owner: { source: "ACTOR" },
  },
];

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

test("defaults transition actions to an empty array", async () => {
  const fixture = await createFixture();

  const transition = await admin.workflowTransitionDefinition.findFirstOrThrow({
    where: { workflowDefinitionId: fixture.workflow.id },
  });

  assert.deepEqual(transition.actions, []);
});

test("round-trips ordered transition actions through JSONB", async () => {
  const fixture = await createFixture({ actions: orderedActions });

  const transition = await admin.workflowTransitionDefinition.findFirstOrThrow({
    where: { workflowDefinitionId: fixture.workflow.id },
  });
  assert.deepEqual(transition.actions, orderedActions);

  const visible = await withSettings(
    runtime,
    { userId: fixture.user.id, tenantId: fixture.tenant.id },
    (tx) =>
      tx.workflowTransitionDefinition.findFirstOrThrow({
        where: { workflowDefinitionId: fixture.workflow.id },
        select: { actions: true },
      }),
  );
  assert.deepEqual(visible.actions, orderedActions);
});

test("rejects transition actions that are not a JSON array", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      admin.$executeRawUnsafe(
        `UPDATE "workflow_transition_definitions"
         SET "actions" = '{}'::jsonb
         WHERE "workflow_definition_id" = $1::uuid`,
        fixture.workflow.id,
      ),
    /workflow_transition_definitions_actions_array/,
  );
});

async function createFixture({ actions } = {}) {
  const user = await admin.user.create({
    data: {
      displayName: "流程动作管理员",
      phone: fixturePhones[0],
      phoneVerifiedAt: new Date(),
      passwordHash: "test-password-hash",
    },
  });
  const tenant = await admin.tenant.create({
    data: { name: "流程动作租户", code: fixtureTenantCodes[0] },
  });
  const member = await admin.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_ADMIN",
      joinedAt: new Date(),
    },
  });
  const object = await admin.objectDefinition.create({
    data: {
      tenantId: tenant.id,
      name: "cases-actions",
      code: "cases-actions",
      titleFieldKey: "name",
    },
  });
  const workflow = await admin.objectWorkflowDefinition.create({
    data: {
      tenantId: tenant.id,
      objectDefinitionId: object.id,
      isEnabled: true,
      initialStateKey: "new",
      createdByMemberId: member.id,
      updatedByMemberId: member.id,
      states: {
        create: [
          { key: "new", label: "新建", sortOrder: 10, isTerminal: false },
          { key: "won", label: "赢单", sortOrder: 20, isTerminal: true },
        ],
      },
      transitions: {
        create: [
          {
            key: "mark-won",
            label: "标记赢单",
            fromStateKey: "new",
            toStateKey: "won",
            allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
            requiredFieldKeys: [],
            sortOrder: 10,
            ...(actions ? { actions } : {}),
          },
        ],
      },
    },
  });

  return { user, tenant, member, object, workflow };
}

function cleanupFixtures() {
  return cleanupTestFixtures(admin, {
    phones: fixturePhones,
    tenantCodes: fixtureTenantCodes,
  });
}
