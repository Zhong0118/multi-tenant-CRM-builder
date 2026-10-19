import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  cleanupTestFixtures,
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
  try {
    for (const f of fixtures)
      await admin.$executeRaw`DELETE FROM record_follow_ups WHERE tenant_id=${f.tenant.id}::uuid`;
    await cleanupTestFixtures(admin, {
      tenantCodes: fixtures.map((f) => f.tenant.code),
      phones: fixtures.flatMap((f) => f.phones),
    });
  } finally {
    await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
  }
});
async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await admin.tenant.create({
    data: { name: suffix, code: `notice-${suffix}`, status: "ACTIVE" },
  });
  const members = [],
    users = [],
    phones = [];
  for (const role of ["TENANT_ADMIN", "EMPLOYEE"]) {
    const phone = `+n${randomUUID().slice(0, 12)}`;
    phones.push(phone);
    const user = await admin.user.create({
      data: {
        displayName: "Notice test",
        phone,
        phoneVerifiedAt: new Date(),
        passwordHash: "test",
      },
    });
    users.push(user);
    members.push(
      await admin.tenantMember.create({
        data: { tenantId: tenant.id, userId: user.id, role },
      }),
    );
  }
  const object = await admin.objectDefinition.create({
    data: {
      tenantId: tenant.id,
      code: "resources",
      name: "Resources",
      titleFieldKey: "name",
      status: "ACTIVE",
      poolEnabled: true,
      poolLifecycleEnabled: true,
      poolContactTtlHours: 4,
      poolFollowUpTtlHours: 48,
    },
  });
  let recordNo = 0;
  const makeRecord = async (
    stage = "PENDING_CONTACT",
    minutes = 30,
    owner = members[1],
  ) => {
    const r = await admin.record.create({
      data: {
        tenantId: tenant.id,
        objectId: object.id,
        recordNo: BigInt(++recordNo),
        title: "SECRET TITLE",
        data: { secret: "PRIVATE" },
        ownerMemberId: owner.id,
      },
    });
    await admin.$executeRaw`UPDATE records SET pool_stage=${stage},ownership_expires_at=CURRENT_TIMESTAMP+${minutes}*interval '1 minute' WHERE id=${r.id}::uuid`;
    return r;
  };
  const run = (index, work) =>
    withSettings(
      runtime,
      { userId: users[index].id, tenantId: tenant.id },
      work,
    );
  const visible = (index = 1) =>
    run(index, (tx) =>
      tx.$queryRawUnsafe(
        "SELECT * FROM current_member_notifications ORDER BY created_at,id",
      ),
    );
  const f = {
    tenant,
    object,
    members,
    users,
    phones,
    makeRecord,
    run,
    visible,
  };
  fixtures.push(f);
  return f;
}
const sweep = () =>
  runtime.$queryRawUnsafe("SELECT sweep_member_notifications(500) AS count");

test("scanner obeys TTL quarter and fixed caps, deduplicates, and never writes business rows", async () => {
  const f = await fixture();
  await f.makeRecord("PENDING_CONTACT", 30);
  await f.makeRecord("PENDING_CONTACT", 90);
  await f.makeRecord("FOLLOWING", 600);
  await f.makeRecord("FOLLOWING", 780);
  const before = await admin.record.findMany({
    where: { tenantId: f.tenant.id },
  });
  await sweep();
  await sweep();
  const rows = await f.visible();
  assert.deepEqual(rows.map((r) => r.kind).sort(), [
    "CONTACT_DUE",
    "FOLLOW_UP_DUE",
  ]);
  assert.deepEqual(
    await admin.record.findMany({ where: { tenantId: f.tenant.id } }),
    before,
  );
  assert.equal(
    JSON.stringify(rows, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ).includes("SECRET TITLE"),
    false,
  );
  assert.equal(
    await f
      .run(0, (tx) =>
        tx.$queryRawUnsafe("SELECT * FROM current_member_notifications"),
      )
      .then((r) => r.length),
    0,
  );
  await admin.objectDefinition.update({
    where: { id: f.object.id },
    data: { poolContactTtlHours: 48, poolFollowUpTtlHours: 720 },
  });
  await f.makeRecord("PENDING_CONTACT", 119);
  await f.makeRecord("PENDING_CONTACT", 121);
  await f.makeRecord("FOLLOWING", 1439);
  await f.makeRecord("FOLLOWING", 1441);
  await sweep();
  assert.equal((await f.visible()).length, 6);
});

test("RLS binds recipient and tenant, rejects forging and changes except read_at", async () => {
  const f = await fixture(),
    other = await fixture();
  await f.makeRecord();
  await other.makeRecord();
  await sweep();
  const [row] = await f.visible();
  assert.ok(row);
  assert.equal(
    (
      await f.run(0, (tx) =>
        tx.$queryRawUnsafe("SELECT * FROM member_notifications"),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await withSettings(
        runtime,
        { userId: f.users[1].id, tenantId: other.tenant.id },
        (tx) => tx.$queryRawUnsafe("SELECT * FROM member_notifications"),
      )
    ).length,
    0,
  );
  await assert.rejects(
    f.run(
      1,
      (tx) =>
        tx.$executeRaw`UPDATE member_notifications SET recipient_member_id=${f.members[0].id}::uuid WHERE id=${row.id}::uuid`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    f.run(
      1,
      (tx) =>
        tx.$executeRaw`DELETE FROM member_notifications WHERE id=${row.id}::uuid`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    f.run(
      1,
      (tx) =>
        tx.$executeRaw`INSERT INTO member_notifications(tenant_id,recipient_member_id,object_id,record_id,kind,event_key) VALUES (${f.tenant.id}::uuid,${f.members[1].id}::uuid,${f.object.id}::uuid,${row.record_id}::uuid,'POOL_RECLAIMED','forged')`,
    ),
    /permission denied/,
  );
  await f.run(
    1,
    (tx) =>
      tx.$executeRaw`UPDATE member_notifications SET read_at=CURRENT_TIMESTAMP WHERE id=${row.id}::uuid`,
  );
  assert.ok((await f.visible())[0].read_at);
  for (const [model, id] of [
    ["tenantMember", f.members[1].id],
    ["user", f.users[1].id],
    ["tenant", f.tenant.id],
  ]) {
    await admin[model].update({
      where: { id },
      data: { status: model === "tenant" ? "SUSPENDED" : "DISABLED" },
    });
    assert.equal((await f.visible()).length, 0);
    await admin[model].update({ where: { id }, data: { status: "ACTIVE" } });
  }
  const [security] = await admin.$queryRawUnsafe(
    "SELECT rolcanlogin,rolbypassrls,rolsuper,has_table_privilege('crm_notification_writer','records','UPDATE') AS business_write FROM pg_roles WHERE rolname='crm_notification_writer'",
  );
  assert.deepEqual(security, {
    rolcanlogin: false,
    rolbypassrls: false,
    rolsuper: false,
    business_write: false,
  });
});

test("current view immediately hides renewed, reassigned, expired, archived and completed notifications", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  await sweep();
  assert.equal((await f.visible()).length, 1);
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=CURRENT_TIMESTAMP+interval '5 hours' WHERE id=${record.id}::uuid`;
  assert.equal((await f.visible()).length, 0);
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=CURRENT_TIMESTAMP+interval '30 minutes' WHERE id=${record.id}::uuid`;
  await sweep();
  assert.equal((await f.visible()).length, 1);
  await admin.record.update({
    where: { id: record.id },
    data: { ownerMemberId: f.members[0].id },
  });
  assert.equal((await f.visible()).length, 0);
  const task = await admin.recordFollowUp.create({
    data: {
      tenantId: f.tenant.id,
      recordId: record.id,
      assigneeMemberId: f.members[1].id,
      title: "PRIVATE TASK",
      dueAt: new Date(Date.now() - 60_000),
    },
  });
  await sweep();
  assert.equal((await f.visible())[0].kind, "TASK_OVERDUE");
  await admin.recordFollowUp.update({
    where: { id: task.id },
    data: { status: "DONE" },
  });
  assert.equal((await f.visible()).length, 0);
  await admin.recordFollowUp.update({
    where: { id: task.id },
    data: { status: "OPEN", dueAt: new Date(Date.now() + 60_000) },
  });
  assert.equal((await f.visible()).length, 0);
  await admin.recordFollowUp.update({
    where: { id: task.id },
    data: { dueAt: new Date(Date.now() - 120_000) },
  });
  await sweep();
  assert.equal((await f.visible()).length, 1);
  await admin.objectDefinition.update({
    where: { id: f.object.id },
    data: { status: "ARCHIVED" },
  });
  assert.equal((await f.visible()).length, 0);
});

test("new reclamation receipt is atomic and runtime cannot forge it through audit logs", async () => {
  const f = await fixture(),
    record = await f.makeRecord("PENDING_CONTACT", -1);
  await assert.rejects(
    f.run(1, async (tx) => {
      await tx.$queryRawUnsafe("SELECT reclaim_expired_record_ownership(100)");
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal((await f.visible()).length, 0);
  assert.equal(
    (await admin.record.findUnique({ where: { id: record.id } })).ownerMemberId,
    f.members[1].id,
  );
  await f.run(1, (tx) =>
    tx.auditLog.create({
      data: {
        tenantId: f.tenant.id,
        actorType: "SYSTEM",
        action: "record.ownership_reclaimed",
        resourceType: "record",
        resourceId: record.id,
        before: { ownerMemberId: f.members[1].id },
        requestId: "forged",
      },
    }),
  );
  assert.equal((await f.visible()).length, 0);
  await runtime.$queryRawUnsafe("SELECT reclaim_expired_record_ownership(100)");
  const rows = await f.visible();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "POOL_RECLAIMED");
  assert.equal(
    (await admin.record.findUnique({ where: { id: record.id } })).ownerMemberId,
    null,
  );
  await sweep();
  assert.equal((await f.visible()).length, 1);
  await admin.record.update({
    where: { id: record.id },
    data: { deletedAt: new Date() },
  });
  assert.equal((await f.visible()).length, 1);
});

test("protection review resolves old messages and creates a fresh second episode", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  await admin.$executeRaw`UPDATE records SET pool_stage='PROTECTED',protection_needs_review=true WHERE id=${record.id}::uuid`;
  const [first] = await f.visible(0);
  assert.equal(first.kind, "PROTECTION_REVIEW");
  assert.equal((await f.visible()).length, 0);
  await sweep();
  assert.equal((await f.visible(0)).length, 1);
  await admin.$executeRaw`UPDATE records SET protection_needs_review=false WHERE id=${record.id}::uuid`;
  assert.equal((await f.visible(0)).length, 0);
  await admin.$executeRaw`UPDATE records SET protection_needs_review=true WHERE id=${record.id}::uuid`;
  const [second] = await f.visible(0);
  assert.notEqual(second.event_key, first.event_key);
  assert.ok(
    (
      await admin.$queryRaw`SELECT resolved_at FROM member_notifications WHERE id=${first.id}::uuid`
    )[0].resolved_at,
  );
});

test("deduplication is independent of the scanning connection timezone", async () => {
  const f = await fixture();
  await f.makeRecord();
  await runtime.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    await tx.$queryRawUnsafe("SELECT sweep_member_notifications(500)");
  });
  await runtime.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Shanghai'");
    await tx.$queryRawUnsafe("SELECT sweep_member_notifications(500)");
  });
  assert.equal((await f.visible()).length, 1);
});

test("notification insertion failure rolls back actual reclamation and audit together", async () => {
  const f = await fixture(),
    record = await f.makeRecord("PENDING_CONTACT", -1);
  await admin.$executeRawUnsafe(
    "ALTER TABLE member_notifications ADD CONSTRAINT notification_failure_test CHECK (kind<>'POOL_RECLAIMED') NOT VALID",
  );
  try {
    await assert.rejects(
      runtime.$queryRawUnsafe("SELECT reclaim_expired_record_ownership(100)"),
      /notification_failure_test/,
    );
    assert.equal(
      (await admin.record.findUnique({ where: { id: record.id } }))
        .ownerMemberId,
      f.members[1].id,
    );
    assert.equal(
      await admin.auditLog.count({
        where: { resourceId: record.id, action: "record.ownership_reclaimed" },
      }),
      0,
    );
    assert.equal((await f.visible()).length, 0);
  } finally {
    await admin.$executeRawUnsafe(
      "ALTER TABLE member_notifications DROP CONSTRAINT notification_failure_test",
    );
  }
});

test("batch limits make progress and concurrent sweeps keep one notification per event", async () => {
  const f = await fixture();
  for (let i = 0; i < 4; i += 1) await f.makeRecord();
  await runtime.$queryRawUnsafe("SELECT sweep_member_notifications(1)");
  assert.equal((await f.visible()).length, 1);
  await Promise.all([sweep(), sweep()]);
  assert.equal((await f.visible()).length, 4);
});

test("notification foreign keys reject another tenant and mismatched object or follow-up", async () => {
  const f = await fixture(),
    other = await fixture();
  const record = await f.makeRecord(),
    otherRecord = await other.makeRecord();
  const task = await admin.recordFollowUp.create({
    data: {
      tenantId: other.tenant.id,
      recordId: otherRecord.id,
      assigneeMemberId: other.members[1].id,
      title: "Other task",
      dueAt: new Date(),
    },
  });
  const data = {
    tenantId: f.tenant.id,
    recipientMemberId: f.members[1].id,
    objectId: f.object.id,
    recordId: record.id,
    kind: "POOL_RECLAIMED",
    eventKey: "foreign-key-test",
  };
  await assert.rejects(
    admin.memberNotification.create({
      data: { ...data, recipientMemberId: other.members[1].id },
    }),
    /Foreign key constraint/,
  );
  await assert.rejects(
    admin.memberNotification.create({
      data: { ...data, recordId: otherRecord.id },
    }),
    /Foreign key constraint/,
  );
  await assert.rejects(
    admin.memberNotification.create({
      data: { ...data, objectId: other.object.id },
    }),
    /Foreign key constraint/,
  );
  await assert.rejects(
    admin.memberNotification.create({
      data: {
        ...data,
        followUpId: task.id,
        kind: "TASK_OVERDUE",
        dueAt: new Date(),
      },
    }),
    /Foreign key constraint/,
  );
});

test("deadline expiry, record deletion, pool disable and task reassignment hide stale notifications immediately", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  await sweep();
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${record.id}::uuid`;
  assert.equal((await f.visible()).length, 0);
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=CURRENT_TIMESTAMP+interval '30 minutes' WHERE id=${record.id}::uuid`;
  await sweep();
  await admin.objectDefinition.update({
    where: { id: f.object.id },
    data: { poolEnabled: false },
  });
  assert.equal((await f.visible()).length, 0);
  await admin.objectDefinition.update({
    where: { id: f.object.id },
    data: { poolEnabled: true },
  });
  await admin.record.update({
    where: { id: record.id },
    data: { deletedAt: new Date() },
  });
  assert.equal((await f.visible()).length, 0);
  await admin.record.update({
    where: { id: record.id },
    data: { deletedAt: null, poolStage: null, ownershipExpiresAt: null },
  });
  const task = await admin.recordFollowUp.create({
    data: {
      tenantId: f.tenant.id,
      recordId: record.id,
      assigneeMemberId: f.members[1].id,
      title: "Task",
      dueAt: new Date(Date.now() - 60_000),
    },
  });
  await sweep();
  assert.equal((await f.visible()).length, 1);
  await admin.recordFollowUp.update({
    where: { id: task.id },
    data: { assigneeMemberId: f.members[0].id },
  });
  assert.equal((await f.visible()).length, 0);
  await sweep();
  assert.equal((await f.visible(0)).length, 1);
  await admin.recordFollowUp.update({
    where: { id: task.id },
    data: { status: "CANCELLED" },
  });
  assert.equal((await f.visible(0)).length, 0);
});

test("a review scan racing with resolution cannot leave an old episode open", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  await admin.$executeRaw`UPDATE records SET pool_stage='PROTECTED',protection_needs_review=true WHERE id=${record.id}::uuid`;
  // Simulate the restart/backfill case, with a current flag and no message yet.
  await admin.memberNotification.deleteMany({ where: { recordId: record.id } });
  await admin.$executeRawUnsafe(`CREATE FUNCTION public.notification_review_test_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
    BEGIN
      IF NEW.tenant_id=TG_ARGV[0]::uuid AND NEW.kind='PROTECTION_REVIEW' THEN
        PERFORM pg_advisory_xact_lock(TG_ARGV[1]::bigint);
      END IF;
      RETURN NEW;
    END $body$`);
  await admin.$executeRawUnsafe(
    `CREATE TRIGGER notification_review_test_barrier BEFORE INSERT ON public.member_notifications FOR EACH ROW EXECUTE FUNCTION public.notification_review_test_barrier('${f.tenant.id}','734276499')`,
  );
  let ready, release;
  const locked = new Promise((resolve) => {
    ready = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const holder = admin.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(734276499)::text");
      ready();
      await held;
    },
    { timeout: 15_000 },
  );
  let scanning, clearing;
  try {
    await locked;
    scanning = runtime.$queryRawUnsafe(
      "SELECT sweep_member_notifications(500) /* notification-review-race-scan */",
    );
    // Start the Prisma promise before inspecting its real PostgreSQL wait.
    scanning = Promise.resolve(scanning);
    let scannerWaiting = false;
    for (let i = 0; i < 200; i += 1) {
      const rows = await admin.$queryRawUnsafe(
        "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%notification-review-race-scan%' AND pid<>pg_backend_pid()",
      );
      if (rows.length) {
        scannerWaiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      scannerWaiting,
      "scanner has read the candidate and is waiting before its notification INSERT",
    );
    let cleared = false;
    clearing =
      admin.$executeRaw`UPDATE records SET protection_needs_review=false WHERE id=${record.id}::uuid /* notification-review-race-clear */`.then(
        () => {
          cleared = true;
        },
      );
    let clearReachedBoundary = false;
    for (let i = 0; i < 200; i += 1) {
      const rows = await admin.$queryRawUnsafe(
        "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%notification-review-race-clear%' AND pid<>pg_backend_pid()",
      );
      if (cleared || rows.length) {
        clearReachedBoundary = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      clearReachedBoundary,
      "resolution has committed or reached the serialization lock",
    );
    release();
    await holder;
    await Promise.all([scanning, clearing]);
    const oldRows = await admin.memberNotification.findMany({
      where: { recordId: record.id },
    });
    assert.equal(
      oldRows.filter((row) => row.resolvedAt === null).length,
      0,
      "the completed episode must have no unresolved messages",
    );
    await admin.memberNotification.updateMany({
      where: { recordId: record.id },
      data: { readAt: new Date() },
    });
    await admin.$executeRaw`UPDATE records SET protection_needs_review=true WHERE id=${record.id}::uuid`;
    const [next] = await f.visible(0);
    assert.ok(next);
    assert.equal(next.read_at, null);
    assert.ok(
      oldRows.every((row) => row.id !== next.id),
      "a fresh review receives a new notification",
    );
  } finally {
    release();
    await Promise.allSettled([holder, scanning, clearing]);
    await admin.$executeRawUnsafe(
      "DROP TRIGGER notification_review_test_barrier ON public.member_notifications",
    );
    await admin.$executeRawUnsafe(
      "DROP FUNCTION public.notification_review_test_barrier()",
    );
  }
});

test("creation transaction snapshot excludes notifications committed after the displayed inbox", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  let ready, release;
  const inserted = new Promise((resolve) => {
    ready = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const holder = admin.$transaction(
    async (tx) => {
      const row = await tx.memberNotification.create({
        data: {
          tenantId: f.tenant.id,
          recipientMemberId: f.members[1].id,
          objectId: f.object.id,
          recordId: record.id,
          kind: "POOL_RECLAIMED",
          eventKey: randomUUID(),
        },
      });
      ready(row);
      await held;
    },
    { timeout: 15_000 },
  );
  try {
    const late = await inserted;
    assert.equal((await f.visible()).length, 0);
    const [displayed] = await f.run(1, (tx) =>
      tx.$queryRawUnsafe(
        "SELECT pg_current_snapshot()::text AS snapshot,CURRENT_TIMESTAMP AS before",
      ),
    );
    release();
    await holder;
    await f.run(
      1,
      (tx) =>
        tx.$executeRaw`UPDATE member_notifications SET read_at=CURRENT_TIMESTAMP WHERE created_at<=${displayed.before} AND pg_visible_in_snapshot(created_xid::xid8,${displayed.snapshot}::pg_snapshot)`,
    );
    const [lateRow] = await f.visible();
    assert.equal(lateRow.id, late.id);
    assert.equal(
      lateRow.read_at,
      null,
      "an invisible in-flight insert must remain unread after read-all",
    );
    const [current] = await f.run(1, (tx) =>
      tx.$queryRawUnsafe(
        "SELECT pg_current_snapshot()::text AS snapshot,CURRENT_TIMESTAMP AS before",
      ),
    );
    await f.run(
      1,
      (tx) =>
        tx.$executeRaw`UPDATE member_notifications SET read_at=CURRENT_TIMESTAMP WHERE created_at<=${current.before} AND pg_visible_in_snapshot(created_xid::xid8,${current.snapshot}::pg_snapshot)`,
    );
    assert.ok((await f.visible())[0].read_at);
    // read_at updates change the row's xmin, but must preserve its creation ID.
    const [stable] =
      await admin.$queryRaw`SELECT pg_visible_in_snapshot(created_xid::xid8,${current.snapshot}::pg_snapshot) AS visible FROM member_notifications WHERE id=${late.id}::uuid`;
    assert.equal(stable.visible, true);
  } finally {
    release();
    await holder;
  }
});

test("review scanner skips business parent locks and its lock privileges cannot write business rows", async () => {
  const f = await fixture(),
    record = await f.makeRecord();
  await admin.$executeRaw`UPDATE records SET pool_stage='PROTECTED',protection_needs_review=true WHERE id=${record.id}::uuid`;
  await admin.memberNotification.deleteMany({ where: { recordId: record.id } });
  for (const table of [
    "tenants",
    "tenant_members",
    "object_definitions",
    "records",
  ]) {
    await assert.rejects(
      admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE crm_notification_writer");
        await tx.$executeRawUnsafe(`UPDATE ${table} SET id=id`);
      }),
      /row-level security/,
    );
  }
  let ready, release;
  const locked = new Promise((resolve) => {
    ready = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const holder = admin.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${f.members[0].id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM object_definitions WHERE id=${f.object.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM records WHERE id=${record.id}::uuid FOR UPDATE`;
      ready();
      await held;
      await tx.$executeRaw`UPDATE records SET protection_needs_review=false WHERE id=${record.id}::uuid`;
    },
    { timeout: 15_000 },
  );
  try {
    await locked;
    await runtime.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='1500ms'");
      await tx.$queryRawUnsafe("SELECT sweep_member_notifications(500)");
    });
    assert.equal((await f.visible(0)).length, 0);
    release();
    await holder;
    await admin.$executeRaw`UPDATE records SET protection_needs_review=true WHERE id=${record.id}::uuid`;
    assert.equal((await f.visible(0)).length, 1);
  } finally {
    release();
    await holder;
  }
});
