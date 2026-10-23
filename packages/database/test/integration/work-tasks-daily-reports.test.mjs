import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const phones = ["+8613800077001", "+8613800077002"];
const tenantCodes = ["work-tenant-a", "work-tenant-b"];

let admin;
let runtime;

before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});
beforeEach(() => cleanupTestFixtures(admin, { tenantCodes, phones }));
afterEach(() => cleanupTestFixtures(admin, { tenantCodes, phones }));
after(async () => {
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

async function fixture() {
  const tenants = await Promise.all(
    tenantCodes.map((code) =>
      admin.tenant.create({ data: { name: code, code, status: "ACTIVE" } }),
    ),
  );
  const users = await Promise.all(
    phones.map((phone) =>
      admin.user.create({
        data: {
          displayName: phone,
          phone,
          phoneVerifiedAt: new Date(),
          passwordHash: "test-password-hash",
        },
      }),
    ),
  );
  const members = await Promise.all(
    tenants.map((tenant, index) =>
      admin.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: users[index].id,
          role: "TENANT_ADMIN",
          status: "ACTIVE",
        },
      }),
    ),
  );
  return { tenants, users, members };
}

test("work tasks and daily reports are visible and writable only inside their company", async () => {
  const { tenants, users, members } = await fixture();
  const [a, b] = [0, 1].map((index) => ({
    tenantId: tenants[index].id,
    userId: users[index].id,
    memberId: members[index].id,
  }));
  await admin.workTask.create({
    data: {
      tenantId: b.tenantId,
      assigneeMemberId: b.memberId,
      createdByMemberId: b.memberId,
      title: "B 的任务",
      dueAt: new Date(),
    },
  });
  await admin.dailyReport.create({
    data: {
      tenantId: b.tenantId,
      memberId: b.memberId,
      workDate: new Date("2026-10-22T00:00:00Z"),
      completed: "B 的日报",
    },
  });

  await withSettings(runtime, a, async (tx) => {
    assert.equal(await tx.workTask.count(), 0);
    assert.equal(await tx.dailyReport.count(), 0);
    await assert.rejects(
      tx.workTask.create({
        data: {
          tenantId: b.tenantId,
          assigneeMemberId: b.memberId,
          createdByMemberId: b.memberId,
          title: "跨公司写入",
          dueAt: new Date(),
        },
      }),
    );
  });
  await withSettings(runtime, a, (tx) =>
    tx.workTask.create({
      data: {
        tenantId: a.tenantId,
        assigneeMemberId: a.memberId,
        createdByMemberId: a.memberId,
        title: "A 的任务",
        dueAt: new Date(),
      },
    }),
  );
  await withSettings(runtime, b, async (tx) => {
    assert.deepEqual(
      (await tx.workTask.findMany()).map((task) => task.title),
      ["B 的任务"],
    );
  });
  // Another company's member cannot be named as assignee even by id.
  await assert.rejects(
    admin.workTask.create({
      data: {
        tenantId: a.tenantId,
        assigneeMemberId: b.memberId,
        createdByMemberId: a.memberId,
        title: "错配成员",
        dueAt: new Date(),
      },
    }),
  );
});

test("a task is done exactly when it has a completion time, and a member writes one report per day", async () => {
  const { tenants, members } = await fixture();
  const base = {
    tenantId: tenants[0].id,
    assigneeMemberId: members[0].id,
    createdByMemberId: members[0].id,
    title: "约束检查",
    dueAt: new Date(),
  };
  await assert.rejects(admin.workTask.create({ data: { ...base, status: "DONE" } }));
  await assert.rejects(
    admin.workTask.create({ data: { ...base, completedAt: new Date() } }),
  );
  await assert.rejects(admin.workTask.create({ data: { ...base, title: "  " } }));
  await admin.workTask.create({
    data: { ...base, status: "DONE", completedAt: new Date() },
  });

  const report = {
    tenantId: tenants[0].id,
    memberId: members[0].id,
    workDate: new Date("2026-10-22T00:00:00Z"),
  };
  await admin.dailyReport.create({ data: report });
  await assert.rejects(admin.dailyReport.create({ data: report }));
});
