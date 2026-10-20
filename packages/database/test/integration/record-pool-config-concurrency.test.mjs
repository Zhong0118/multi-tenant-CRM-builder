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
const fixtureTenants = [];
const fixturePhones = [];
before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});
after(async () => {
  try {
    await admin.recordActivity.deleteMany({
      where: { tenantId: { in: fixtureTenants.map((tenant) => tenant.id) } },
    });
    for (const tenant of fixtureTenants)
      await admin.$executeRaw`DELETE FROM record_relations WHERE tenant_id=${tenant.id}::uuid`;
    await cleanupTestFixtures(admin, {
      tenantCodes: fixtureTenants.map((tenant) => tenant.code),
      phones: fixturePhones,
    });
  } finally {
    await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
  }
});

async function fixture({
  owner = true,
  employee = false,
  readable = true,
  writable = true,
} = {}) {
  const suffix = randomUUID().slice(0, 8);
  const user = await admin.user.create({
    data: {
      displayName: "Protection test",
      phone: `+p${suffix}`,
      phoneVerifiedAt: new Date(),
      passwordHash: "test",
    },
  });
  const tenant = await admin.tenant.create({
    data: { name: suffix, code: `protection-${suffix}`, status: "ACTIVE" },
  });
  fixtureTenants.push(tenant);
  fixturePhones.push(user.phone);
  const member = await admin.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: employee ? "EMPLOYEE" : "TENANT_ADMIN",
      joinedAt: new Date(),
    },
  });
  const target = await admin.objectDefinition.create({
    data: {
      tenantId: tenant.id,
      name: "Resources",
      code: "resources",
      titleFieldKey: "name",
      status: "ACTIVE",
    },
  });
  const source = await admin.objectDefinition.create({
    data: {
      tenantId: tenant.id,
      name: "Agreements",
      code: "agreements",
      titleFieldKey: "name",
      status: "ACTIVE",
    },
  });
  for (const object of [source, target]) {
    const publication = await admin.objectPublication.create({
      data: {
        tenantId: tenant.id,
        objectId: object.id,
        publicationNo: 1,
        sourceDraftVersion: 1,
        publishedByMemberId: member.id,
        changeSummary: {},
        configuration: {
          object: { id: object.id, code: object.code, titleFieldKey: "name" },
          fields: [{ fieldKey: "name", isSystem: false }],
          employeeAccess: {
            canRead: readable,
            canUpdate: writable,
            readScope: "OWN",
            updateScope: "OWN",
            fields: { name: "EDIT" },
          },
          workflow: {
            initialStateKey: "draft",
            states: [{ key: "draft" }, { key: "confirmed" }],
            transitions: [],
          },
        },
      },
    });
    await admin.objectDefinition.update({
      where: { id: object.id },
      data: { activePublicationId: publication.id },
    });
  }
  await admin.$executeRaw`UPDATE object_definitions SET pool_enabled=true, pool_lifecycle_enabled=true, pool_protection_rules='[{"sourceObjectCode":"agreements","statusKeys":["confirmed"]}]'::jsonb WHERE id=${target.id}::uuid`;
  const record = await admin.record.create({
    data: {
      tenantId: tenant.id,
      objectId: target.id,
      recordNo: 1n,
      title: "Resource",
      data: {},
      source: "MANUAL",
      createdByMemberId: member.id,
      ownerMemberId: owner ? member.id : null,
    },
  });
  if (owner)
    await admin.$executeRaw`UPDATE records SET pool_stage='FOLLOWING', ownership_expires_at=CURRENT_TIMESTAMP + interval '1 hour' WHERE id=${record.id}::uuid`;
  const evidence = await admin.record.create({
    data: {
      tenantId: tenant.id,
      objectId: source.id,
      recordNo: 1n,
      title: "Agreement",
      data: {},
      source: "MANUAL",
      createdByMemberId: member.id,
      ownerMemberId: member.id,
      statusKey: "draft",
    },
  });
  const settings = { userId: user.id, tenantId: tenant.id };
  const run = (work) => withSettings(runtime, settings, work);
  const link = (id = evidence.id) =>
    run(
      (tx) =>
        tx.$executeRaw`INSERT INTO record_relations(id,tenant_id,source_record_id,target_record_id) VALUES (${randomUUID()}::uuid,${tenant.id}::uuid,${[record.id, id].sort()[0]}::uuid,${[record.id, id].sort()[1]}::uuid) ON CONFLICT DO NOTHING`,
    );
  const confirm = (id = evidence.id) =>
    run(
      (tx) =>
        tx.$executeRaw`UPDATE records SET status_key='confirmed',version=version+1 WHERE id=${id}::uuid`,
    );
  const state = async () =>
    (
      await admin.$queryRaw`SELECT pool_stage,owner_member_id,ownership_expires_at,pool_protected_at,protection_needs_review,version FROM records WHERE id=${record.id}::uuid`
    )[0];
  return {
    user,
    tenant,
    member,
    target,
    source,
    record,
    evidence,
    run,
    link,
    confirm,
    state,
  };
}

async function confirmWhileConfigurationIsLocked(f, change) {
  let ready, release;
  const gate = new Promise((resolve) => {
    ready = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const updating = f.run(async (tx) => {
    await change(tx);
    ready();
    await held;
  });
  await gate;
  let finished = false;
  const confirming = f.confirm().then(() => {
    finished = true;
  });
  try {
    for (let attempt = 0; attempt < 100 && !finished; attempt += 1) {
      const [waiting] =
        await admin.$queryRaw`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%UPDATE records SET status_key%'`;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
    await updating;
  }
  await confirming;
}

test("removing protection rules concurrently with confirmation does not use stale rules", async () => {
  const f = await fixture();
  await f.link();
  await confirmWhileConfigurationIsLocked(
    f,
    (tx) =>
      tx.$executeRaw`UPDATE object_definitions SET pool_protection_rules='[]'::jsonb WHERE id=${f.target.id}::uuid`,
  );
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
  assert.equal(
    (await admin.record.findUnique({ where: { id: f.evidence.id } })).statusKey,
    "confirmed",
  );
});

test("archiving a source concurrently with confirmation does not use stale publication eligibility", async () => {
  const f = await fixture();
  await f.link();
  await confirmWhileConfigurationIsLocked(
    f,
    (tx) =>
      tx.$executeRaw`UPDATE object_definitions SET status='ARCHIVED' WHERE id=${f.source.id}::uuid`,
  );
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
});

for (const change of ["rules", "source"]) {
  test(`confirmation before ${change} change retains protection and ${change === "rules" ? "requests review" : "preserves review state on stop"}`, async () => {
    const f = await fixture();
    await f.link();
    let ready, release;
    const gate = new Promise((resolve) => {
      ready = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const confirming = f.run(async (tx) => {
      await tx.$executeRaw`UPDATE records SET status_key='confirmed',version=version+1 WHERE id=${f.evidence.id}::uuid`;
      ready();
      await held;
    });
    await gate;
    const changing = f.run((tx) =>
      change === "rules"
        ? tx.$executeRaw`UPDATE object_definitions SET pool_protection_rules='[]'::jsonb WHERE id=${f.target.id}::uuid`
        : tx.$executeRaw`UPDATE object_definitions SET status='ARCHIVED' WHERE id=${f.source.id}::uuid`,
    );
    try {
      let waiting;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        [waiting] =
          await admin.$queryRaw`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%UPDATE object_definitions SET%'`;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(
        waiting,
        "configuration waits for the in-flight protection transaction",
      );
    } finally {
      release();
      await confirming;
    }
    await changing;
    const state = await f.state();
    assert.equal(state.pool_stage, "PROTECTED");
    assert.equal(state.protection_needs_review, change === "rules");
    assert.equal(state.ownership_expires_at, null);
  });
}
