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

test("confirmation atomically protects, clears expiry, preserves owner and is idempotent", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  const protectedState = await f.state();
  assert.equal(protectedState.pool_stage, "PROTECTED");
  assert.equal(protectedState.owner_member_id, f.member.id);
  assert.equal(protectedState.ownership_expires_at, null);
  assert.ok(protectedState.pool_protected_at);
  assert.equal(protectedState.protection_needs_review, false);
  await f.confirm();
  assert.deepEqual(await f.state(), protectedState);
});

test("linking already confirmed evidence applies protection in the relation transaction", async () => {
  const f = await fixture();
  await f.confirm();
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
  await f.link();
  assert.equal((await f.state()).pool_stage, "PROTECTED");
});

test("unassigned targets fail confirmation and relation insertion without partial writes", async () => {
  const f = await fixture({ owner: false });
  await f.link();
  await assert.rejects(f.confirm, /POOL_PROTECTION_OWNER_REQUIRED/);
  assert.equal(
    (await admin.record.findUnique({ where: { id: f.evidence.id } })).statusKey,
    "draft",
  );
  assert.equal((await f.state()).pool_stage, null);
  const other = await fixture({ owner: false });
  await other.confirm();
  await assert.rejects(other.link, /POOL_PROTECTION_OWNER_REQUIRED/);
});

test("multiple evidence retains protection; last invalidation marks review without deadline", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  const second = await admin.record.create({
    data: {
      tenantId: f.tenant.id,
      objectId: f.source.id,
      recordNo: 2n,
      title: "Second agreement",
      data: {},
      source: "MANUAL",
      createdByMemberId: f.member.id,
      ownerMemberId: f.member.id,
      statusKey: "confirmed",
    },
  });
  await f.link(second.id);
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET status_key='draft' WHERE id=${f.evidence.id}::uuid`,
  );
  assert.equal((await f.state()).protection_needs_review, false);
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET deleted_at=CURRENT_TIMESTAMP WHERE id=${second.id}::uuid`,
  );
  const state = await f.state();
  assert.equal(state.pool_stage, "PROTECTED");
  assert.equal(state.protection_needs_review, true);
  assert.equal(state.ownership_expires_at, null);
});

test("relation removal invalidates evidence and source draft changes do not count", async () => {
  const f = await fixture();
  await f.link();
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET status_key='unknown_signed_text' WHERE id=${f.evidence.id}::uuid`,
  );
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
  await f.confirm();
  await f.run(
    (tx) =>
      tx.$executeRaw`DELETE FROM record_relations WHERE tenant_id=${f.tenant.id}::uuid`,
  );
  assert.equal((await f.state()).protection_needs_review, true);
});

test("read-only actors cannot protect a target and errors omit target details", async () => {
  const f = await fixture({ employee: true, writable: false });
  await f.link();
  await assert.rejects(f.confirm, /POOL_PROTECTION_FORBIDDEN/);
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
});

test("cross-tenant relations are rejected and rollback preserves confirmation and target", async () => {
  const a = await fixture(),
    b = await fixture();
  await assert.rejects(() =>
    a.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO record_relations(id,tenant_id,source_record_id,target_record_id) VALUES (${randomUUID()}::uuid,${a.tenant.id}::uuid,${a.evidence.id}::uuid,${b.record.id}::uuid)`,
    ),
  );
  await a.link();
  await assert.rejects(
    () =>
      a.run(async (tx) => {
        await tx.$executeRaw`UPDATE records SET status_key='confirmed' WHERE id=${a.evidence.id}::uuid`;
        throw new Error("intentional rollback");
      }),
    /intentional rollback/,
  );
  assert.equal((await a.state()).pool_stage, "FOLLOWING");
});

test("confirmed protection wins while a concurrent sweep skips the locked target", async () => {
  const f = await fixture();
  await f.link();
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=statement_timestamp()+interval '0.2 seconds' WHERE id=${f.record.id}::uuid`;
  let ready;
  const gate = new Promise((resolve) => {
    ready = resolve;
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const confirming = f.run(async (tx) => {
    await tx.$executeRaw`UPDATE records SET status_key='confirmed' WHERE id=${f.evidence.id}::uuid`;
    ready();
    await held;
  });
  await gate;
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    await runtime.$queryRaw`SELECT reclaim_expired_record_ownership(100)`;
  } finally {
    release();
  }
  await confirming;
  assert.equal((await f.state()).pool_stage, "PROTECTED");
  assert.equal((await f.state()).owner_member_id, f.member.id);
});

test("withdrawing a source publication requests review and config save never enrolls old records", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE object_definitions SET active_publication_id=NULL WHERE id=${f.source.id}::uuid`,
  );
  assert.equal((await f.state()).protection_needs_review, true);
  const legacy = await fixture();
  await legacy.confirm();
  await admin.$executeRaw`UPDATE object_definitions SET pool_protection_rules=pool_protection_rules WHERE id=${legacy.target.id}::uuid`;
  assert.equal((await legacy.state()).pool_stage, "FOLLOWING");
});

test("pure source stop and restore preserve existing protection and review metadata", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  const before = await f.state();
  for (const status of ["ARCHIVED", "ACTIVE"]) {
    await f.run(
      (tx) =>
        tx.$executeRaw`UPDATE object_definitions SET status=${status}::"ObjectStatus" WHERE id=${f.source.id}::uuid`,
    );
    assert.deepEqual(await f.state(), before);
  }
});

test("target OWN scope, hidden title and member override remain authoritative", async () => {
  const otherOwner = await fixture({ employee: true });
  await otherOwner.link();
  const otherUser = await admin.user.create({
    data: {
      displayName: "Other owner",
      phone: `+o${randomUUID().slice(0, 8)}`,
      phoneVerifiedAt: new Date(),
      passwordHash: "test",
    },
  });
  fixturePhones.push(otherUser.phone);
  const otherMember = await admin.tenantMember.create({
    data: {
      tenantId: otherOwner.tenant.id,
      userId: otherUser.id,
      role: "EMPLOYEE",
      joinedAt: new Date(),
    },
  });
  await admin.$executeRaw`UPDATE records SET owner_member_id=${otherMember.id}::uuid WHERE id=${otherOwner.record.id}::uuid`;
  await assert.rejects(otherOwner.confirm, /POOL_PROTECTION_FORBIDDEN/);
  const hidden = await fixture({ employee: true });
  await hidden.link();
  const field = await admin.fieldDefinition.create({
    data: {
      tenantId: hidden.tenant.id,
      objectId: hidden.target.id,
      fieldKey: "name",
      label: "Name",
      type: "TEXT",
      sortOrder: 1,
    },
  });
  await admin.memberFieldPermission.create({
    data: {
      tenantId: hidden.tenant.id,
      objectId: hidden.target.id,
      fieldId: field.id,
      memberId: hidden.member.id,
      access: "HIDDEN",
    },
  });
  await assert.rejects(hidden.confirm, /POOL_PROTECTION_FORBIDDEN/);
  const override = await fixture({ employee: true });
  await override.link();
  await admin.objectPermission.create({
    data: {
      tenantId: override.tenant.id,
      objectId: override.target.id,
      subjectType: "MEMBER",
      subjectMemberId: override.member.id,
      canRead: true,
      canUpdate: false,
      readScope: "ALL",
      updateScope: "NONE",
    },
  });
  await assert.rejects(override.confirm, /POOL_PROTECTION_FORBIDDEN/);
});

test("concurrent independent evidence invalidations see the last committed evidence", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  const second = await admin.record.create({
    data: {
      tenantId: f.tenant.id,
      objectId: f.source.id,
      recordNo: 2n,
      title: "Second agreement",
      data: {},
      source: "MANUAL",
      createdByMemberId: f.member.id,
      ownerMemberId: f.member.id,
      statusKey: "confirmed",
    },
  });
  await f.link(second.id);
  let ready;
  const gate = new Promise((resolve) => {
    ready = resolve;
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const first = f.run(async (tx) => {
    await tx.$executeRaw`UPDATE records SET status_key='draft' WHERE id=${f.evidence.id}::uuid`;
    ready();
    await held;
  });
  await gate;
  const secondInvalidation = f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET status_key='draft' WHERE id=${second.id}::uuid`,
  );
  release();
  await Promise.all([first, secondInvalidation]);
  assert.equal((await f.state()).pool_stage, "PROTECTED");
  assert.equal((await f.state()).protection_needs_review, true);
});

test("reclamation before confirmation rejects conversion until administrator reassigns", async () => {
  const f = await fixture();
  await f.link();
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=${f.record.id}::uuid`;
  await runtime.$queryRaw`SELECT reclaim_expired_record_ownership(100)`;
  await assert.rejects(f.confirm, /POOL_PROTECTION_OWNER_REQUIRED/);
  assert.equal((await f.state()).pool_stage, "CUSTOMER_POOL");
});

test("explicit administrator release is not undone by an unrelated source edit", async () => {
  const f = await fixture();
  await f.link();
  await f.confirm();
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET pool_stage='CUSTOMER_POOL',owner_member_id=NULL,in_public_pool=true,pool_protected_at=NULL,protection_needs_review=false WHERE id=${f.record.id}::uuid`,
  );
  await f.run(
    (tx) =>
      tx.$executeRaw`UPDATE records SET title='Edited agreement',status_key=status_key WHERE id=${f.evidence.id}::uuid`,
  );
  assert.equal((await f.state()).pool_stage, "CUSTOMER_POOL");
});

test("an expired owner cannot be protected before the scheduler has reclaimed it", async () => {
  const f = await fixture();
  await f.link();
  await admin.$executeRaw`UPDATE records SET ownership_expires_at=statement_timestamp() WHERE id=${f.record.id}::uuid`;
  await assert.rejects(f.confirm, /POOL_PROTECTION_EXPIRED/);
  assert.equal(
    (await admin.record.findUnique({ where: { id: f.evidence.id } })).statusKey,
    "draft",
  );
  assert.equal((await f.state()).pool_stage, "FOLLOWING");
});

async function releasedWithOldEvidence({ linkDraft = true } = {}) {
  const f = await fixture();
  const draft = await admin.record.create({
    data: {
      tenantId: f.tenant.id, objectId: f.source.id, recordNo: 2n,
      title: "Unconfirmed agreement", data: {}, source: "MANUAL",
      createdByMemberId: f.member.id, ownerMemberId: f.member.id,
      statusKey: "draft",
    },
  });
  await f.link();
  if (linkDraft) await f.link(draft.id);
  await f.confirm();
  await f.run((tx) => tx.$executeRaw`UPDATE records SET pool_stage='CUSTOMER_POOL',owner_member_id=NULL,in_public_pool=true,pool_protected_at=NULL,protection_needs_review=false WHERE id=${f.record.id}::uuid`);
  return { ...f, draft };
}

for (const event of ["status", "delete", "unlink", "link"]) {
  test(`released records are not reprotected by unrelated ${event} events`, async () => {
    const f = await releasedWithOldEvidence({ linkDraft: event !== "link" });
    if (event === "link") await f.link(f.draft.id);
    else await f.run((tx) => {
      if (event === "status") return tx.$executeRaw`UPDATE records SET status_key=NULL WHERE id=${f.draft.id}::uuid`;
      if (event === "delete") return tx.$executeRaw`UPDATE records SET deleted_at=CURRENT_TIMESTAMP WHERE id=${f.draft.id}::uuid`;
      return tx.$executeRaw`DELETE FROM record_relations WHERE tenant_id=${f.tenant.id}::uuid AND (source_record_id=${f.draft.id}::uuid OR target_record_id=${f.draft.id}::uuid)`;
    });
    assert.equal((await f.state()).pool_stage, "CUSTOMER_POOL");
    assert.equal((await f.state()).owner_member_id, null);
  });
}

test("old evidence does not protect a new claimant on unrelated status changes", async () => {
  const f = await releasedWithOldEvidence();
  await f.run((tx) => tx.$executeRaw`UPDATE records SET owner_member_id=${f.member.id}::uuid WHERE id=${f.record.id}::uuid`);
  assert.equal((await f.state()).pool_stage, "PENDING_CONTACT");
  await f.run((tx) => tx.$executeRaw`UPDATE records SET status_key=NULL WHERE id=${f.draft.id}::uuid`);
  assert.equal((await f.state()).pool_stage, "PENDING_CONTACT");
  assert.ok((await f.state()).ownership_expires_at);
  await f.confirm(f.draft.id);
  assert.equal((await f.state()).pool_stage, "PROTECTED");
});
