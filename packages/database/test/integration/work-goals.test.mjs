import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";
let admin, runtime;
const fixtures = [];
before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});
after(async () => {
  if (admin)
    for (const f of fixtures) {
      await admin.$executeRaw`DELETE FROM member_notifications WHERE tenant_id=${f.tenant.id}::uuid`;
      await admin.$executeRaw`DELETE FROM work_goal_rules WHERE tenant_id=${f.tenant.id}::uuid`;
      await admin.recordFollowUp.deleteMany({
        where: { tenantId: f.tenant.id },
      });
      await admin.recordActivity.deleteMany({
        where: { tenantId: f.tenant.id },
      });
      await admin.record.deleteMany({ where: { tenantId: f.tenant.id } });
      await admin.objectDefinition.deleteMany({
        where: { tenantId: f.tenant.id },
      });
      await admin.workTask.deleteMany({ where: { tenantId: f.tenant.id } });
      await admin.tenantMember.deleteMany({ where: { tenantId: f.tenant.id } });
      await admin.tenant.delete({ where: { id: f.tenant.id } });
      await admin.user.delete({ where: { id: f.user.id } });
    }
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});
async function fixture(timezone = "Pacific/Kiritimati") {
  const tenant = await admin.tenant.create({
    data: {
      code: `goal-${randomUUID()}`,
      name: "Goals",
      status: "ACTIVE",
      timezone,
    },
  });
  const user = await admin.user.create({
    data: {
      phone: `+g${randomUUID().slice(0, 12)}`,
      phoneVerifiedAt: new Date(),
      passwordHash: "test",
      displayName: "Goal employee",
    },
  });
  const member = await admin.tenantMember.create({
    data: { tenantId: tenant.id, userId: user.id, role: "EMPLOYEE" },
  });
  const f = { tenant, user, member };
  fixtures.push(f);
  return f;
}
async function rule(f, metric = "calls") {
  const [row] = await admin.$queryRawUnsafe(
    `INSERT INTO work_goal_rules(tenant_id,metric,target,remind_at,weekdays,audience) VALUES ($1::uuid,$2,2,'00:00',ARRAY[1,2,3,4,5,6,7],'ALL_EMPLOYEES') RETURNING *`,
    f.tenant.id,
    metric,
  );
  return row;
}
const sweep = (size = 500) =>
  runtime.$queryRawUnsafe(
    "SELECT sweep_work_goal_notifications($1::int) AS count",
    size,
  );
const notices = (f) =>
  withSettings(runtime, { tenantId: f.tenant.id, userId: f.user.id }, (tx) =>
    tx.$queryRawUnsafe(
      "SELECT * FROM current_member_notifications WHERE kind='WORK_GOAL_BEHIND'",
    ),
  );
test("company-date snapshots are recipient-only, immutable and concurrently deduplicated", async () => {
  const f = await fixture(),
    other = await fixture();
  const goal = await rule(f, "tasksDone");
  await admin.$executeRaw`UPDATE work_goal_rules SET created_at=now()-interval '3 days' WHERE id=${goal.id}::uuid`;
  await admin.workTask.create({
    data: {
      tenantId: f.tenant.id,
      assigneeMemberId: f.member.id,
      createdByMemberId: f.member.id,
      title: "Done",
      dueAt: new Date(),
      status: "DONE",
      completedAt: new Date(),
    },
  });
  await Promise.all([sweep(), sweep(), sweep()]);
  let rows = await notices(f);
  assert.equal(rows.length, 1);
  assert.equal((await notices(other)).length, 0);
  assert.equal(rows[0].details.actual, 1);
  assert.equal(rows[0].details.target, 2);
  const [day] =
    await admin.$queryRaw`SELECT (now() AT TIME ZONE ${f.tenant.timezone})::date::text AS day`;
  assert.equal(rows[0].details.date, day.day);
  assert.equal(rows[0].object_id, null);
  await admin.workTask.create({
    data: {
      tenantId: f.tenant.id,
      assigneeMemberId: f.member.id,
      createdByMemberId: f.member.id,
      title: "Later completion",
      dueAt: new Date(),
      status: "DONE",
      completedAt: new Date(),
    },
  });
  const current = await withSettings(
    runtime,
    { tenantId: f.tenant.id, userId: f.user.id },
    (tx) =>
      tx.$queryRaw`SELECT * FROM count_member_goal_work(${f.tenant.id}::uuid,${day.day}::date::timestamp AT TIME ZONE ${f.tenant.timezone},(${day.day}::date+1)::timestamp AT TIME ZONE ${f.tenant.timezone},ARRAY[${f.member.id}::uuid]) WHERE metric='tasksDone'`,
  );
  assert.equal(current[0].actual, 2);
  await admin.$executeRaw`UPDATE work_goal_rules SET target=4 WHERE id=${goal.id}::uuid`;
  await sweep();
  rows = await notices(f);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details.target, 2);
  assert.equal(rows[0].details.actual, 1);
  await assert.rejects(
    withSettings(
      runtime,
      { tenantId: f.tenant.id, userId: f.user.id },
      (tx) =>
        tx.$executeRaw`INSERT INTO member_notifications(tenant_id,recipient_member_id,kind,event_key,goal_rule_id,details) VALUES (${f.tenant.id}::uuid,${f.member.id}::uuid,'WORK_GOAL_BEHIND','fake',${goal.id}::uuid,'{}')`,
    ),
    /permission denied/,
  );
});
test("reached goals, disabled accounts/members/rules, unselected members and non-workdays do not notify", async () => {
  for (const condition of [
    "reached",
    "user",
    "member",
    "rule",
    "selected",
    "weekday",
  ]) {
    const f = await fixture();
    const g = await rule(f);
    if (condition === "reached")
      await admin.$executeRaw`UPDATE work_goal_rules SET metric='tasksDone',target=1 WHERE id=${g.id}::uuid`;
    if (condition === "reached")
      await admin.workTask.create({
        data: {
          tenantId: f.tenant.id,
          assigneeMemberId: f.member.id,
          createdByMemberId: f.member.id,
          title: "Done",
          dueAt: new Date(),
          status: "DONE",
          completedAt: new Date(),
        },
      });
    if (condition === "user")
      await admin.user.update({
        where: { id: f.user.id },
        data: { status: "DISABLED" },
      });
    if (condition === "member")
      await admin.tenantMember.update({
        where: { id: f.member.id },
        data: { status: "DISABLED" },
      });
    if (condition === "rule")
      await admin.$executeRaw`UPDATE work_goal_rules SET enabled=false WHERE id=${g.id}::uuid`;
    if (condition === "selected")
      await admin.$executeRaw`UPDATE work_goal_rules SET audience='SELECTED_MEMBERS' WHERE id=${g.id}::uuid`;
    if (condition === "weekday")
      await admin.$executeRaw`UPDATE work_goal_rules SET weekdays=ARRAY[CASE WHEN extract(isodow FROM now() AT TIME ZONE ${f.tenant.timezone})::int=7 THEN 1 ELSE 7 END] WHERE id=${g.id}::uuid`;
    await sweep();
    assert.equal(
      await admin.memberNotification.count({
        where: { tenantId: f.tenant.id },
      }),
      0,
      condition,
    );
  }
});
test("bounded scans progress beyond already sent and reached recipients; same-tenant constraints and RLS hold", async () => {
  const f = await fixture(),
    other = await fixture();
  const g = await rule(f);
  await rule(f, "connectedCalls");
  await rule(f, "wechatAdded");
  await sweep(1);
  await sweep(1);
  await sweep(1);
  await sweep(1);
  assert.equal((await notices(f)).length, 3);
  await assert.rejects(
    admin.$executeRaw`INSERT INTO work_goal_recipients(tenant_id,rule_id,member_id) VALUES (${f.tenant.id}::uuid,${g.id}::uuid,${other.member.id}::uuid)`,
    /foreign key/,
  );
  const hidden = await withSettings(
    runtime,
    { tenantId: other.tenant.id, userId: other.user.id },
    (tx) => tx.$queryRaw`SELECT * FROM work_goal_rules WHERE id=${g.id}::uuid`,
  );
  assert.equal(hidden.length, 0);
});
test("scanner skips locked rows before its batch limit and rechecks concurrent rule/member/account disable", async () => {
  for (const entity of ["rule", "member", "user"]) {
    const f = await fixture(),
      g = await rule(f),
      next = await rule(f, "tasksDone");
    await admin.$transaction(async (tx) => {
      if (entity === "rule")
        await tx.$queryRaw`SELECT id FROM work_goal_rules WHERE id=${g.id}::uuid FOR UPDATE`;
      if (entity === "member")
        await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${f.member.id}::uuid FOR UPDATE`;
      if (entity === "user")
        await tx.$queryRaw`SELECT id FROM users WHERE id=${f.user.id}::uuid FOR UPDATE`;
      await sweep(entity === "rule" ? 1 : 500);
      assert.equal(
        await admin.memberNotification.count({ where: { goalRuleId: g.id } }),
        0,
        entity,
      );
      if (entity === "rule") {
        assert.equal(
          await admin.memberNotification.count({
            where: { goalRuleId: next.id },
          }),
          1,
        );
        await tx.$executeRaw`UPDATE work_goal_rules SET enabled=false WHERE id=${g.id}::uuid`;
      }
      if (entity === "member")
        await tx.$executeRaw`UPDATE tenant_members SET status='DISABLED' WHERE id=${f.member.id}::uuid`;
      if (entity === "user")
        await tx.$executeRaw`UPDATE users SET status='DISABLED' WHERE id=${f.user.id}::uuid`;
    });
    await sweep();
    assert.equal(
      await admin.memberNotification.count({ where: { goalRuleId: g.id } }),
      0,
    );
  }
});
test("shared metrics preserve six definitions across DST days and first WeChat entry, distinct pool customers and completion boundaries", async () => {
  const f = await fixture("America/New_York");
  const pool = await admin.objectDefinition.create({
    data: {
      tenantId: f.tenant.id,
      code: "customers",
      name: "Customers",
      titleFieldKey: "name",
      status: "ACTIVE",
      poolEnabled: true,
    },
  });
  const plain = await admin.objectDefinition.create({
    data: {
      tenantId: f.tenant.id,
      code: "other",
      name: "Other",
      titleFieldKey: "name",
      status: "ACTIVE",
    },
  });
  const records = [];
  for (const [i, o] of [pool, pool, plain].entries())
    records.push(
      await admin.record.create({
        data: {
          tenantId: f.tenant.id,
          objectId: o.id,
          recordNo: BigInt(i + 1),
          title: "Customer",
          data: {},
        },
      }),
    );
  const log = (i, type, result, at) =>
    admin.recordActivity.create({
      data: {
        tenantId: f.tenant.id,
        recordId: records[i].id,
        actorMemberId: f.member.id,
        activityType: type,
        resultKey: result,
        content: "Recorded",
        createdAt: new Date(at),
      },
    });
  await log(0, "MESSAGE", "WECHAT_ADDED", "2026-03-08T04:59:59Z"); // previous company day
  await log(0, "MESSAGE", "WECHAT_ADDED", "2026-03-08T05:00:00Z");
  await log(1, "MESSAGE", "WECHAT_ADDED", "2026-03-08T06:00:00Z");
  await log(1, "MESSAGE", "WECHAT_ADDED", "2026-03-08T07:00:00Z");
  await log(0, "CALL", "CONNECTED", "2026-03-08T08:00:00Z");
  await log(0, "CALL", "NOT_REACHED", "2026-03-08T09:00:00Z");
  await log(2, "CALL", "CONNECTED", "2026-03-09T03:59:59Z");
  await log(1, "CALL", "CONNECTED", "2026-03-09T04:00:00Z"); // next company day
  for (const at of [
    "2026-03-08T05:00:00Z",
    "2026-03-09T03:59:59Z",
    "2026-03-09T04:00:00Z",
  ])
    await admin.workTask.create({
      data: {
        tenantId: f.tenant.id,
        assigneeMemberId: f.member.id,
        createdByMemberId: f.member.id,
        title: "Task",
        status: "DONE",
        dueAt: new Date("2025-01-01"),
        completedAt: new Date(at),
      },
    });
  for (const i of [0, 1])
    await admin.recordFollowUp.create({
      data: {
        tenantId: f.tenant.id,
        recordId: records[i].id,
        assigneeMemberId: f.member.id,
        title: "Follow",
        status: "DONE",
        dueAt: new Date("2025-01-01"),
        completedAt: new Date("2026-03-08T07:00:00Z"),
      },
    });
  await admin.record.update({
    where: { id: records[1].id },
    data: { deletedAt: new Date() },
  });
  const counts = await withSettings(
    runtime,
    { tenantId: f.tenant.id, userId: f.user.id },
    (tx) =>
      tx.$queryRaw`SELECT * FROM count_member_goal_work(${f.tenant.id}::uuid,'2026-03-08'::timestamp AT TIME ZONE 'America/New_York','2026-03-09'::timestamp AT TIME ZONE 'America/New_York',ARRAY[${f.member.id}::uuid])`,
  );
  assert.deepEqual(
    Object.fromEntries(counts.map((c) => [c.metric, c.actual])),
    {
      calls: 3,
      connectedCalls: 2,
      wechatAdded: 1,
      customersFollowed: 2,
      followUpsDone: 1,
      tasksDone: 2,
    },
  );
  const [dst] = await admin.$queryRawUnsafe(
    "SELECT extract(epoch FROM ('2026-03-09'::timestamp AT TIME ZONE 'America/New_York')-('2026-03-08'::timestamp AT TIME ZONE 'America/New_York'))::int/3600 AS spring,extract(epoch FROM ('2026-11-02'::timestamp AT TIME ZONE 'America/New_York')-('2026-11-01'::timestamp AT TIME ZONE 'America/New_York'))::int/3600 AS fall",
  );
  assert.deepEqual(dst, { spring: 23, fall: 25 });
});

test("notification writer can lock accounts but cannot mutate them", async () => {
  const f = await fixture();
  await assert.rejects(
    admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE crm_notification_writer");
      await tx.$executeRaw`UPDATE users SET id=id WHERE id=${f.user.id}::uuid`;
    }),
    /notification writer cannot modify accounts/,
  );
});
