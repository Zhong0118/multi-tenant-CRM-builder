import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import {
  createTestClients,
  migrateTestDatabase,
  withSettings,
  cleanupTestFixtures,
} from "./helpers.mjs";

let admin, runtime, platform, a, b, staff, lead, outsider, planId;
const tenantCodes = ["ai-ledger-a", "ai-ledger-b"];
const phones = Array.from({ length: 4 }, (_, i) => "+861380000518" + i);
const q = (tx, sql, ...args) => tx.$queryRawUnsafe(sql, ...args);
const as = (member, work) =>
  withSettings(
    runtime,
    { tenantId: member.tenantId, userId: member.userId },
    work,
  );
const asPlatform = (work) =>
  withSettings(runtime, { userId: platform.id }, work);
const reserve = (member, id, input = 1500) =>
  as(
    member,
    async (tx) =>
      (
        await q(
          tx,
          "select code from ai_reserve_call($1::uuid,$2::uuid,$3::uuid,'req','filter','test','test-flash',$4::bigint,3500,now()+interval '1 minute')",
          member.tenantId,
          member.id,
          id,
          input,
        )
      )[0].code,
  );
const settle = (member, id, status, i, o) =>
  as(member, (tx) =>
    tx.$executeRawUnsafe(
      "select ai_settle_call($1::uuid,$2::uuid,$3::uuid,$4,$5::bigint,$6::bigint)",
      member.tenantId,
      member.id,
      id,
      status,
      i ?? null,
      o ?? null,
    ),
  );
const month = async () =>
  (
    await q(
      admin,
      "select month::text as month,input_tokens,output_tokens,reserved_tokens from ai_tenant_months where tenant_id=$1::uuid order by month desc limit 1",
      a.id,
    )
  )[0];
const setCap = (tokens) =>
  asPlatform((tx) =>
    tx.$executeRawUnsafe(
      "update ai_plans set monthly_tokens=$1::bigint where id=$2::uuid",
      tokens,
      planId,
    ),
  );
const clearUsage = async () => {
  await admin.$executeRawUnsafe(
    "delete from ai_tenant_months where tenant_id=$1::uuid",
    a.id,
  );
  await admin.$executeRawUnsafe(
    "delete from ai_daily_usage where tenant_id=$1::uuid",
    a.id,
  );
  await admin.$executeRawUnsafe(
    "delete from ai_operation_records where tenant_id=$1::uuid",
    a.id,
  );
  await admin.$executeRawUnsafe(
    "delete from member_notifications where tenant_id=$1::uuid",
    a.id,
  );
};

before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  await cleanupTestFixtures(admin, { tenantCodes, phones });
  await admin.$executeRawUnsafe(
    "delete from ai_plans where name='ledger integration'",
  );
  const users = await Promise.all(
    phones.map((phone, i) =>
      admin.user.create({
        data: {
          phone,
          displayName: phone,
          phoneVerifiedAt: new Date(),
          passwordHash: "fixture",
          isPlatformAdmin: i === 0,
        },
      }),
    ),
  );
  platform = users[0];
  [a, b] = await Promise.all(
    tenantCodes.map((code) =>
      admin.tenant.create({ data: { code, name: code, status: "ACTIVE" } }),
    ),
  );
  [staff, lead, outsider] = await Promise.all(
    [
      [a, users[1], "EMPLOYEE"],
      [a, users[2], "TENANT_ADMIN"],
      [b, users[3], "EMPLOYEE"],
    ].map(([tenant, user, role]) =>
      admin.tenantMember.create({
        data: { tenantId: tenant.id, userId: user.id, role },
      }),
    ),
  );
  [{ id: planId }] = await asPlatform((tx) =>
    q(
      tx,
      "insert into ai_plans(name,features,monthly_tokens) values('ledger integration',array['assistant','filter'],10000) returning id",
    ),
  );
  assert.equal(
    (
      await asPlatform((tx) =>
        q(tx, "select ai_assign_plan($1::uuid,$2::uuid,1) as ok", a.id, planId),
      )
    )[0].ok,
    true,
  );
});

after(async () => {
  if (admin) {
    await cleanupTestFixtures(admin, { tenantCodes, phones });
    await admin.$executeRawUnsafe(
      "delete from ai_plans where name='ledger integration'",
    );
  }
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

test("real runtime role serializes company reservations, settles positive estimation error once, notifies twice, and resumes after top-up", async () => {
  const calls = Array.from({ length: 3 }, (_, n) => ({
    member: n === 0 ? staff : lead,
    id: randomUUID(),
  }));
  const result = await Promise.all(calls.map((c) => reserve(c.member, c.id)));
  assert.deepEqual(
    [...result].sort(),
    ["AI_BUDGET_RESERVED", null, null].sort(),
  );
  assert.equal((await month()).reserved_tokens, 10000n);
  const admitted = calls.filter((_, n) => !result[n]);
  await Promise.all(
    admitted.map((c, n) =>
      settle(c.member, c.id, "success", n ? 4800 : 4700, n ? 430 : 410),
    ),
  );
  await settle(admitted[0].member, admitted[0].id, "success", 4700, 410);
  const used = await month();
  assert.deepEqual(
    [used.input_tokens, used.output_tokens, used.reserved_tokens],
    [9500n, 840n, 0n],
  );
  assert.equal(await reserve(staff, randomUUID()), "AI_TENANT_QUOTA_EXHAUSTED");
  const anomalies = await asPlatform((tx) =>
    q(tx, "select * from ai_anomaly_summary() where model='test-flash'"),
  );
  assert.deepEqual(anomalies, [
    { model: "test-flash", calls: 2n, excess_tokens: 340n },
  ]);
  const notices = await as(lead, (tx) =>
    q(
      tx,
      "select kind from current_member_notifications where kind like 'AI_QUOTA_%' order by kind",
    ),
  );
  assert.deepEqual(
    notices.map((n) => n.kind),
    ["AI_QUOTA_100", "AI_QUOTA_80"],
  );
  const topup = (n) =>
    asPlatform((tx) =>
      q(
        tx,
        "select ai_add_quota($1::uuid,$2::date,$3::bigint,'replay') as added",
        a.id,
        used.month,
        n,
      ),
    );
  assert.equal((await topup(6000))[0].added, true);
  assert.equal((await topup(6000))[0].added, false);
  await assert.rejects(topup(6001));
  const last = randomUUID();
  assert.equal(await reserve(staff, last), null);
  await settle(staff, last, "unsent");
  assert.equal((await month()).input_tokens, 9500n);
  assert.equal((await month()).reserved_tokens, 0n);
  assert.equal(
    (
      await as(lead, (tx) =>
        q(
          tx,
          "select kind from current_member_notifications where kind like 'AI_QUOTA_%'",
        ),
      )
    ).length,
    2,
  );
});

test("forced tenant isolation, per-member visibility and platform-only assignment", async () => {
  for (const table of [
    "ai_operation_records",
    "ai_model_calls",
    "ai_member_months",
  ]) {
    assert.deepEqual(
      await asPlatform((tx) =>
        q(
          tx,
          "select tenant_id from " + table + " where tenant_id=$1::uuid",
          a.id,
        ),
      ),
      [],
    );
    assert.deepEqual(
      await as(outsider, (tx) =>
        q(
          tx,
          "select tenant_id from " + table + " where tenant_id=$1::uuid",
          a.id,
        ),
      ),
      [],
    );
  }
  assert.deepEqual(
    await as(staff, (tx) =>
      q(tx, "select * from ai_member_months where member_id=$1::uuid", lead.id),
    ),
    [],
  );
  assert.deepEqual(
    await as(staff, (tx) =>
      q(
        tx,
        "select * from ai_operation_records where tenant_id=$1::uuid",
        a.id,
      ),
    ),
    [],
  );
  assert.equal(
    await as(outsider, (tx) =>
      tx.$executeRawUnsafe(
        "update tenant_ai_configs set allocation='equal' where tenant_id=$1::uuid",
        a.id,
      ),
    ),
    0,
  );
  await assert.rejects(
    as(lead, (tx) =>
      tx.$executeRawUnsafe(
        "update tenant_ai_configs set plan_id=null where tenant_id=$1::uuid",
        a.id,
      ),
    ),
    /denied/i,
  );
  await assert.rejects(
    as(staff, (tx) => q(tx, "select ai_assign_plan($1::uuid,null,2)", a.id)),
    /insufficient_privilege|permission denied|42501/i,
  );
  await assert.rejects(
    as(staff, (tx) =>
      q(
        tx,
        "select ai_finish_call($1::uuid,$2::uuid,'unsent',0,0,false)",
        a.id,
        randomUUID(),
      ),
    ),
    /denied/i,
  );
  await assert.rejects(
    as(staff, (tx) =>
      tx.$executeRawUnsafe(
        "update ai_tenant_months set extra_tokens=90000 where tenant_id=$1::uuid",
        a.id,
      ),
    ),
    /denied/i,
  );
});

test("expired reservation from a previous local month is estimated then corrected once to the original day and month", async () => {
  await clearUsage();
  const call = randomUUID();
  assert.equal(await reserve(staff, call), null);
  // Seed the durable pre-crash state as of the prior month. Wall-clock control
  // in the application would not move PostgreSQL transaction timestamps.
  const [{ d }] = await q(
    admin,
    "select (date_trunc('month',now() at time zone timezone)-interval '1 day')::date::text as d from tenants where id=$1::uuid",
    a.id,
  );
  const prev = d.slice(0, 7) + "-01";
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "insert into ai_tenant_months(tenant_id,month,reserved_tokens) values($1::uuid,$2::date,5000)",
      a.id,
      prev,
    );
    await tx.$executeRawUnsafe(
      "insert into ai_member_months(tenant_id,month,member_id,reserved_tokens) values($1::uuid,$2::date,$3::uuid,5000)",
      a.id,
      prev,
      staff.id,
    );
    await tx.$executeRawUnsafe(
      "update ai_model_calls set month=$1::date,local_date=$2::date,expires_at=now()-interval '1 second' where id=$3::uuid",
      prev,
      d,
      call,
    );
    await tx.$executeRawUnsafe(
      "delete from ai_tenant_months where tenant_id=$1::uuid and month<>$2::date",
      a.id,
      prev,
    );
  });
  assert.equal(
    (
      await as(lead, (tx) =>
        q(tx, "select ai_recover_expired($1::uuid) as n", a.id),
      )
    )[0].n,
    1,
  );
  assert.deepEqual(await month(), {
    month: prev,
    input_tokens: 1500n,
    output_tokens: 3500n,
    reserved_tokens: 0n,
  });
  await settle(staff, call, "cancelled", 350, undefined);
  await settle(staff, call, "cancelled", 350, 120);
  await settle(staff, call, "success", 9999, 9999);
  assert.deepEqual(await month(), {
    month: prev,
    input_tokens: 350n,
    output_tokens: 120n,
    reserved_tokens: 0n,
  });
  assert.deepEqual(
    await as(lead, (tx) =>
      q(
        tx,
        "select calls,input_tokens,output_tokens,local_date::text from ai_daily_usage where tenant_id=$1::uuid",
        a.id,
      ),
    ),
    [{ calls: 1n, input_tokens: 350n, output_tokens: 120n, local_date: d }],
  );
  assert.deepEqual(
    await as(staff, (tx) =>
      q(
        tx,
        "select status,input_estimated,output_estimated from ai_model_calls where id=$1::uuid",
        call,
      ),
    ),
    [{ status: "cancelled", input_estimated: false, output_estimated: false }],
  );
});

test("equal shares react to member status and allocation, and emergency/feature gates precede quota", async () => {
  await clearUsage();
  await setCap(9999);
  await as(lead, (tx) =>
    tx.$executeRawUnsafe(
      "update tenant_ai_configs set allocation='equal', version=version+1 where tenant_id=$1::uuid",
      a.id,
    ),
  );
  assert.equal(
    await reserve(staff, randomUUID()),
    "AI_REQUEST_BUDGET_INSUFFICIENT",
  );
  const call = randomUUID();
  assert.equal(await reserve(staff, call, 1499), null);
  await settle(staff, call, "success", 1499, 3500);
  assert.equal(
    await reserve(staff, randomUUID(), 0),
    "AI_MEMBER_QUOTA_EXHAUSTED",
  );
  await admin.tenantMember.update({
    where: { id: lead.id },
    data: { status: "DISABLED" },
  });
  const next = randomUUID();
  assert.equal(await reserve(staff, next), null);
  await settle(staff, next, "unsent");
  await admin.tenantMember.update({
    where: { id: lead.id },
    data: { status: "ACTIVE" },
  });
  assert.equal(
    await reserve(staff, randomUUID(), 0),
    "AI_MEMBER_QUOTA_EXHAUSTED",
  );
  await asPlatform((tx) =>
    tx.$executeRawUnsafe(
      "update ai_plans set features=array['assistant'] where id=$1::uuid",
      planId,
    ),
  );
  assert.equal(await reserve(staff, randomUUID()), "AI_FEATURE_NOT_INCLUDED");
  await asPlatform((tx) =>
    tx.$executeRawUnsafe("update ai_platform_settings set disabled=true"),
  );
  try {
    assert.equal(await reserve(staff, randomUUID()), "AI_PLATFORM_DISABLED");
  } finally {
    await asPlatform((tx) =>
      tx.$executeRawUnsafe("update ai_platform_settings set disabled=false"),
    );
  }
});

test("proposal projections count each proposal and first confirmation separately and copy only display changes", async () => {
  const conversation = await admin.aiConversation.create({
    data: {
      tenantId: a.id,
      createdByMemberId: staff.id,
      title: "never project conversation history",
      lastMessageAt: new Date(),
    },
  });
  const row = await as(staff, (tx) =>
    tx.aiOperation.create({
      data: {
        tenantId: a.id,
        conversationId: conversation.id,
        turnId: randomUUID(),
        requestedByMemberId: staff.id,
        operationType: "UPDATE_RECORD",
        requestText: "改联系人",
        proposalJson: { secret: "private raw arguments" },
        displayChangesJson: {
          changes: [
            {
              label: "联系人",
              fieldKey: "contact",
              before: "甲",
              after: "乙",
              private: "not for display",
            },
          ],
          trace: "private trace",
        },
        targetRefJson: { recordId: randomUUID() },
        expectedPublicationId: randomUUID(),
        expiresAt: new Date(Date.now() + 600000),
      },
    }),
  );
  const confirm = () =>
    as(staff, (tx) =>
      tx.aiOperation.update({
        where: { id: row.id },
        data: {
          status: "EXECUTED",
          confirmedByMemberId: staff.id,
          executedAt: new Date(),
        },
      }),
    );
  await confirm();
  await confirm();
  const details = await as(lead, (tx) =>
    q(
      tx,
      "select source,changes,request_text from ai_operation_records where id=$1::uuid",
      row.id,
    ),
  );
  assert.deepEqual(details, [
    {
      source: "proposal",
      request_text: "改联系人",
      changes: {
        operationType: "UPDATE_RECORD",
        changes: [
          { label: "联系人", fieldKey: "contact", before: "甲", after: "乙" },
        ],
      },
    },
  ]);
  const sums = await as(lead, (tx) =>
    q(
      tx,
      "select proposals,confirmations,input_tokens,output_tokens,calls from ai_daily_usage where tenant_id=$1::uuid and feature='write_proposal'",
      a.id,
    ),
  );
  assert.deepEqual(sums, [
    {
      proposals: 1n,
      confirmations: 1n,
      input_tokens: 0n,
      output_tokens: 0n,
      calls: 0n,
    },
  ]);
});

test("AI blueprint and generic sibling audits are private to the company and roll back with the business transaction", async () => {
  const requestId = randomUUID(),
    manualId = randomUUID();
  const object = await admin.objectDefinition.create({
    data: {
      tenantId: a.id,
      code: "governed_object",
      name: "测试",
      titleFieldKey: "title",
    },
  });
  const event = {
    tenantId: a.id,
    actorType: "USER",
    actorId: lead.userId,
    resourceType: "object_definition",
    resourceId: object.id,
    requestId,
    after: { name: "private" },
  };
  const audit = (tx, action, rid) =>
    tx.auditLog.create({ data: { ...event, action, requestId: rid } });
  await as(lead, (tx) => audit(tx, "object.created", manualId));
  await assert.rejects(
    as(lead, async (tx) => {
      await audit(tx, "ai.table_blueprint_confirmed", requestId);
      throw new Error("rollback fixture");
    }),
    /rollback fixture/,
  );
  const entries = () =>
    as(lead, (tx) =>
      q(
        tx,
        "select id,source,audit_id from ai_operation_records where source='blueprint' and object_id=$1::uuid",
        object.id,
      ),
    );
  assert.deepEqual(await entries(), []);
  const source = await as(lead, async (tx) => {
    await audit(tx, "object.created", requestId);
    return audit(tx, "ai.table_blueprint_confirmed", requestId);
  });
  assert.deepEqual(await entries(), [
    { id: source.id, source: "blueprint", audit_id: source.id },
  ]);
  const platformLogs = await asPlatform((tx) =>
    tx.auditLog.findMany({
      where: { tenantId: a.id, requestId: { in: [requestId, manualId] } },
      select: { requestId: true },
    }),
  );
  assert.deepEqual(platformLogs, [{ requestId: manualId }]);
});

test("a nullable default applies only to future tenants, and platform audit rolls back with its setting", async () => {
  const before = await as(staff, (tx) =>
    q(
      tx,
      "select plan_id from tenant_ai_configs where tenant_id=$1::uuid",
      a.id,
    ),
  );
  await assert.rejects(
    asPlatform(async (tx) => {
      await tx.$executeRawUnsafe(
        "update ai_platform_settings set default_plan_id=null",
      );
      const next = await tx.tenant.create({
        data: { code: "governance-default-rollback", name: "temporary tenant" },
      });
      assert.deepEqual(
        await q(
          tx,
          "select plan_id from tenant_ai_configs where tenant_id=$1::uuid",
          next.id,
        ),
        [{ plan_id: null }],
      );
      assert.deepEqual(
        await q(
          tx,
          "select plan_id from tenant_ai_configs where tenant_id=$1::uuid",
          a.id,
        ),
        before,
      );
      await tx.auditLog.create({
        data: {
          tenantId: a.id,
          actorType: "USER",
          actorId: platform.id,
          action: "ai.plan_assigned",
          resourceType: "tenant_ai_config",
          resourceId: a.id,
          requestId: "governance-rollback-test",
          after: { planId: null },
        },
      });
      throw new Error("rollback fixture");
    }),
    /rollback fixture/,
  );
  assert.deepEqual(
    await asPlatform((tx) =>
      tx.auditLog.findMany({
        where: { requestId: "governance-rollback-test" },
      }),
    ),
    [],
  );
});

test("calendar keys use the two company time zones, including opposite sides of midnight", async () => {
  await clearUsage();
  await asPlatform((tx) =>
    tx.$executeRawUnsafe(
      "update ai_plans set features=array['filter'] where id=$1::uuid",
      planId,
    ),
  );
  await admin.tenant.update({
    where: { id: a.id },
    data: { timezone: "Pacific/Kiritimati" },
  });
  await admin.tenant.update({
    where: { id: b.id },
    data: { timezone: "Etc/GMT+12" },
  });
  const ids = [randomUUID(), randomUUID()];
  assert.equal(await reserve(staff, ids[0], 1000), null);
  assert.equal(await reserve(outsider, ids[1], 1000), null);
  const rows = await q(
    admin,
    `select c.local_date::text as day,
     (c.started_at at time zone t.timezone)::date::text as expected,
     date_trunc('month',c.started_at at time zone t.timezone)::date=c.month as correct_month
     from ai_model_calls c join tenants t on t.id=c.tenant_id where c.id in ($1::uuid,$2::uuid)`,
    ...ids,
  );
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].day, rows[1].day);
  assert.ok(rows.every((r) => r.day === r.expected && r.correct_month));
});

test("platform recovery only sweeps expired calls and cannot reveal member rows", async () => {
  await clearUsage();
  const id = randomUUID();
  assert.equal(await reserve(staff, id, 1000), null);
  await admin.$executeRawUnsafe(
    "update ai_model_calls set expires_at=now()-interval '1 second' where id=$1::uuid",
    id,
  );
  await assert.rejects(
    as(staff, (tx) => q(tx, "select ai_recover_platform_expired()")),
    /42501|permission denied|insufficient_privilege/i,
  );
  assert.equal(
    (
      await asPlatform((tx) =>
        q(tx, "select ai_recover_platform_expired() as n"),
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await asPlatform((tx) =>
        q(tx, "select ai_recover_platform_expired() as n"),
      )
    )[0].n,
    0,
  );
  assert.equal((await month()).reserved_tokens, 0n);
  assert.equal((await month()).input_tokens, 1000n);
});

test("effective quota can add a top-up to the maximum bigint plan", async () => {
  await clearUsage();
  await setCap(9223372036854775807n);
  const [{ mo }] = await q(
    admin,
    "select date_trunc('month',now() at time zone timezone)::date::text as mo from tenants where id=$1::uuid",
    a.id,
  );
  assert.equal(
    (
      await asPlatform((tx) =>
        q(
          tx,
          "select ai_add_quota($1::uuid,$2::date,10,'bigint-total') as added",
          a.id,
          mo,
        ),
      )
    )[0].added,
    true,
  );
  const call = randomUUID();
  assert.equal(await reserve(staff, call), null);
  await settle(staff, call, "success", 1, 1);
  assert.equal((await month()).input_tokens, 1n);
});

test("the feature catalog keeps existing plans and rejects duplicate, unknown or dependent-only grants", async () => {
  const rows = await q(
    admin,
    "SELECT key,released FROM ai_feature_catalog ORDER BY position",
  );
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.at(-1), { key: "import_assist", released: true });
  const plans = await q(admin, "SELECT features FROM ai_plans WHERE id = $1::uuid", planId);
  assert.equal(plans[0].features.includes("import_assist"), false);
  assert.deepEqual(
    rows.filter((r) => !r.released).map((r) => r.key),
    [],
  );
  for (const keys of [
    "ARRAY['assistant','assistant']",
    "ARRAY['unknown']",
    "ARRAY['write_proposal']",
    "ARRAY[NULL]::text[]",
  ]) {
    await assert.rejects(
      asPlatform((tx) =>
        tx.$executeRawUnsafe(
          "UPDATE ai_plans SET features=" + keys + " WHERE id=$1::uuid",
          planId,
        ),
      ),
    );
  }
});

test("snapshots keep historical cost across allocation changes and protect tenant pricing", async () => {
  await clearUsage();
  await setCap(100000);
  const legacy = randomUUID();
  assert.equal(await reserve(staff, legacy), null);
  await settle(staff, legacy, "success", 10, 5);
  const revision = randomUUID(),
    provider = randomUUID();
  for (const [version, currency, outputPrice] of [
    [1, "USD", "8"],
    [2, "CNY", null],
  ]) {
    const call = randomUUID();
    const data = {
      configSource: "platform",
      purpose: "text",
      providerId: provider,
      revisionId: revision,
      assignmentVersion: version,
      inputPrice: "2",
      outputPrice,
      currency,
    };
    const [row] = await as(staff, (tx) =>
      q(
        tx,
        "SELECT code FROM ai_reserve_snapshot_call($1::uuid,$2::uuid,$3::uuid,'snapshot','filter','openai','trial',100::bigint,3500::bigint,now()+interval '1 minute',$4::jsonb)",
        a.id,
        staff.id,
        call,
        JSON.stringify(data),
      ),
    );
    assert.equal(row.code, null);
    await settle(staff, call, "success", 100, 25);
  }
  const { month: mo } = await month();
  const sql =
    "select currency,calls,priced_input_tokens,priced_output_tokens,known_cost::float8 from ai_company_model_costs($1::uuid,$2::date) order by currency nulls last";
  const costs = await asPlatform((tx) => q(tx, sql, a.id, mo));
  assert.deepEqual(costs, [
    {
      currency: "CNY",
      calls: 1n,
      priced_input_tokens: 100n,
      priced_output_tokens: 0n,
      known_cost: 0.0002,
    },
    {
      currency: "USD",
      calls: 1n,
      priced_input_tokens: 100n,
      priced_output_tokens: 25n,
      known_cost: 0.0004,
    },
    {
      currency: null,
      calls: 1n,
      priced_input_tokens: 0n,
      priced_output_tokens: 0n,
      known_cost: null,
    },
  ]);
  assert.deepEqual(await as(lead, (tx) => q(tx, sql, a.id, mo)), []);
  await assert.rejects(
    as(staff, (tx) => q(tx, "select input_price from ai_model_calls limit 1")),
    /permission denied|42501/,
  );
  assert.equal(
    (
      await q(
        admin,
        "select config_source from ai_model_calls where id=$1::uuid",
        legacy,
      )
    )[0].config_source,
    "historical",
  );
});
