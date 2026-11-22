import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const tenantCodes = ["record-views-one", "record-views-two"];
const phones = Array.from({ length: 6 }, (_, i) => `+861390000053${i}`);
const cleanup = { tenantCodes, phones };
let admin,
  runtime,
  tenant,
  otherTenant,
  manager,
  sales,
  peer,
  outsider,
  platform,
  disabled;
let object;
const empty = { version: 1, match: "all", conditions: [] };
const columns = ["stage", "amount"];
const sort = { field: "updatedAt", direction: "desc" };

before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  await cleanupTestFixtures(admin, cleanup);
  [tenant, otherTenant] = await Promise.all(
    tenantCodes.map((code) =>
      admin.tenant.create({ data: { code, name: code, status: "ACTIVE" } }),
    ),
  );
  const accounts = await Promise.all(
    phones.map((phone, i) =>
      admin.user.create({
        data: {
          phone,
          displayName: phone,
          phoneVerifiedAt: new Date(),
          passwordHash: "test",
          isPlatformAdmin: i === 4,
        },
      }),
    ),
  );
  [manager, sales, peer, outsider, platform, disabled] = accounts;
  await Promise.all(
    [manager, sales, peer, outsider, disabled].map((user) =>
      admin.tenantMember.create({
        data: {
          userId: user.id,
          tenantId: user === outsider ? otherTenant.id : tenant.id,
          role: user === manager ? "TENANT_ADMIN" : "EMPLOYEE",
          status: user === disabled ? "DISABLED" : "ACTIVE",
        },
      }),
    ),
  );
  object = await createObject("opportunities");
  await admin.fieldDefinition.createMany({
    data: [
      {
        tenantId: tenant.id,
        objectId: object.id,
        fieldKey: "stage",
        label: "阶段",
        type: "SINGLE_SELECT",
      },
      {
        tenantId: tenant.id,
        objectId: object.id,
        fieldKey: "amount",
        label: "金额",
        type: "MONEY",
      },
    ],
  });
});
after(async () => {
  if (admin) await cleanupTestFixtures(admin, cleanup);
  await Promise.all([admin?.$disconnect(), runtime?.$disconnect()]);
});

function createObject(code) {
  return admin.objectDefinition.create({
    data: {
      code,
      name: code,
      titleFieldKey: "stage",
      tenantId: tenant.id,
    },
  });
}
function acting(user, work, tenantId = tenant.id) {
  return withSettings(runtime, { tenantId, userId: user?.id }, work);
}
function member(user) {
  return admin.tenantMember.findFirstOrThrow({ where: { userId: user.id } });
}
function designRow(objectId) {
  return {
    tenantId: tenant.id,
    objectId,
    code: "default",
    name: "设计器",
    columnFieldKeys: columns,
    sort,
  };
}
async function publish(obj, publicationNo) {
  const publisher = await member(manager);
  return acting(manager, async (tx) => {
    const publication = await tx.objectPublication.create({
      data: {
        tenantId: tenant.id,
        objectId: obj.id,
        publicationNo,
        sourceDraftVersion: publicationNo,
        configuration: {
          defaultView: { code: "default", columnFieldKeys: columns, sort },
        },
        changeSummary: [],
        publishedByMemberId: publisher.id,
      },
    });
    return tx.objectDefinition.update({
      where: { id: obj.id },
      data: {
        activePublicationId: publication.id,
        publishedAt: publication.publishedAt,
        status: "ACTIVE",
      },
    });
  });
}

test("crm_app preserves platform template initialization and default designer updates", async () => {
  const defaults = await acting(platform, (tx) =>
    tx.viewDefinition.create({ data: designRow(object.id) }),
  );
  const patch = (user, name) =>
    acting(user, (tx) =>
      tx.viewDefinition.updateMany({
        where: { id: defaults.id },
        data: { name },
      }),
    );
  assert.deepEqual(await patch(sales, "unauthorized"), { count: 0 });
  assert.deepEqual(await patch(platform, "unauthorized"), { count: 0 });
  assert.deepEqual(await patch(manager, "设计器视图"), { count: 1 });
  const saved = await acting(sales, (tx) =>
    tx.viewDefinition.findUnique({ where: { id: defaults.id } }),
  );
  assert.equal(saved.scope, "DEFAULT");
  assert.deepEqual(saved.columnFieldKeys, columns);
  assert.deepEqual(saved.sort, sort);
  assert.equal(saved.name, "设计器视图");
});

test("a published business object gains three shared views once and keeps admin edits on republication", async () => {
  const obj = await createObject("quotes");
  const views = () =>
    acting(sales, (tx) =>
      tx.viewDefinition.findMany({
        where: { objectId: obj.id },
        orderBy: { code: "asc" },
      }),
    );
  assert.deepEqual(await views(), []);
  await publish(obj, 1);
  const presets = await views();
  assert.deepEqual(
    presets.map((row) => row.code),
    ["all", "my_records", "today_follow_up"],
  );
  assert.deepEqual(
    presets.map((row) => row.name),
    ["全部（按权限）", "我负责的", "今天待跟进"],
  );
  assert.deepEqual(
    presets.map((row) => row.filterRule),
    [
      empty,
      {
        ...empty,
        conditions: [{ fieldKey: "$owner", operator: "in", value: ["$me"] }],
      },
      {
        ...empty,
        conditions: [{ fieldKey: "$followUp", operator: "dueThroughToday" }],
      },
    ],
  );
  for (const row of presets) {
    assert.equal(row.scope, "SHARED");
    assert.equal(row.ownerMemberId, null);
    assert.equal(row.columnFieldKeys, null);
    assert.equal(row.sort, null);
    assert.deepEqual(row.columnWidths, {});
    assert.deepEqual(row.queryOptions, {});
    assert.equal(row.revision, 1);
  }
  await acting(manager, async (tx) => {
    await tx.viewDefinition.update({
      where: { id: presets[0].id },
      data: { name: "全部商机", revision: 2 },
    });
    await tx.viewDefinition.update({
      where: { id: presets[1].id },
      data: { status: "INACTIVE" },
    });
  });
  await publish(obj, 2);
  const after = await views();
  assert.deepEqual(
    after.map((row) => row.id),
    presets.map((row) => row.id),
  );
  assert.equal(after[0].name, "全部商机");
  assert.equal(after[0].revision, 2);
  assert.equal(after[1].status, "INACTIVE");
});

test("crm_app sees and changes only its own personal views and only tenant admins write shared views", async () => {
  const obj = await createObject("pipeline");
  await publish(obj, 1);
  const owner = await member(sales);
  const otherOwner = await member(peer);
  const create = (user, data) =>
    acting(user, (tx) =>
      tx.viewDefinition.create({
        data: {
          ...designRow(obj.id),
          code: "sales-private",
          scope: "PERSONAL",
          ownerMemberId: owner.id,
          ...data,
        },
      }),
    );
  const personal = await create(sales, {});
  const shared = await create(manager, {
    scope: "SHARED",
    code: "team",
    ownerMemberId: null,
  });
  for (const user of [
    sales,
    peer,
    manager,
    platform,
    outsider,
    disabled,
    null,
  ]) {
    const result = await acting(user, (tx) =>
      tx.viewDefinition.findMany({
        where: { id: { in: [personal.id, shared.id] } },
        orderBy: { code: "asc" },
        select: { code: true },
      }),
    );
    const expected =
      user === sales
        ? ["sales-private", "team"]
        : [peer, manager].includes(user)
          ? ["team"]
          : [];
    assert.deepEqual(
      result.map((row) => row.code),
      expected,
    );
  }
  const crossTenant = await acting(
    sales,
    (tx) =>
      tx.viewDefinition.findMany({
        where: { objectId: obj.id },
      }),
    otherTenant.id,
  );
  assert.deepEqual(crossTenant, []);
  const change = (user, id, data) =>
    acting(user, (tx) => tx.viewDefinition.updateMany({ where: { id }, data }));
  assert.deepEqual(await change(sales, personal.id, { name: "仅自己" }), {
    count: 1,
  });
  for (const user of [peer, manager]) {
    assert.deepEqual(await change(user, personal.id, { name: "伪造" }), {
      count: 0,
    });
  }
  assert.deepEqual(await change(sales, shared.id, { status: "INACTIVE" }), {
    count: 0,
  });
  for (const [user, invalid] of [
    [sales, { code: "not-mine", ownerMemberId: otherOwner.id }],
    [sales, { code: "forged-team", scope: "SHARED", ownerMemberId: null }],
    [platform, { code: "platform-team", scope: "SHARED", ownerMemberId: null }],
    [outsider, { code: "cross-tenant" }],
  ]) {
    await assert.rejects(() => create(user, invalid), /row.level security/iu);
  }
  for (const data of [
    { objectId: object.id },
    { ownerMemberId: otherOwner.id },
    { scope: "SHARED", ownerMemberId: null },
  ]) {
    await assert.rejects(() => change(sales, personal.id, data));
  }
  await assert.rejects(() =>
    change(manager, shared.id, {
      scope: "PERSONAL",
      ownerMemberId: owner.id,
    }),
  );
  assert.deepEqual(
    await acting(peer, (tx) =>
      tx.viewDefinition.deleteMany({ where: { id: personal.id } }),
    ),
    { count: 0 },
  );
  assert.deepEqual(
    await acting(sales, (tx) =>
      tx.viewDefinition.deleteMany({ where: { id: shared.id } }),
    ),
    { count: 0 },
  );
  const foreignMember = await member(outsider);
  await assert.rejects(
    () =>
      admin.viewDefinition.create({
        data: {
          ...designRow(obj.id),
          code: "wrong-company",
          scope: "PERSONAL",
          ownerMemberId: foreignMember.id,
        },
      }),
    { code: "P2003" },
  );
  await assert.rejects(() =>
    admin.viewDefinition.create({
      data: {
        ...designRow(obj.id),
        code: "missing-owner",
        scope: "PERSONAL",
      },
    }),
  );
});

test("the correlated open follow-up lookup has a partial record and due date index", async () => {
  const indexes = await admin.$queryRaw`
    SELECT pg_get_indexdef(indexrelid) AS definition, pg_get_expr(indpred, indrelid) AS predicate
    FROM pg_index WHERE indrelid = 'record_follow_ups'::regclass AND indpred IS NOT NULL
  `;
  assert.ok(
    indexes.some(
      (row) =>
        row.definition.includes("(tenant_id, record_id, status, due_at)") &&
        row.predicate.includes("'OPEN'"),
    ),
  );
});

test("0049 upgrades populated legacy tables while retaining designer settings on drafts and publications", async () => {
  // Replay the real migration against transaction-local copies. The suite can
  // also run against a database on which all migrations are already installed.
  const source = await readFile(
    new URL(
      "../../prisma/migrations/0049_record_views/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const migration = source
    .replace(/^BEGIN;|COMMIT;\s*$/g, "")
    .replaceAll("public.", "view_upgrade.");
  const sql = `
    BEGIN;
    CREATE SCHEMA view_upgrade;
    SET LOCAL search_path = view_upgrade, public;
    CREATE TABLE view_upgrade.view_definitions (LIKE public.view_definitions INCLUDING DEFAULTS INCLUDING INDEXES);
    ALTER TABLE view_upgrade.view_definitions DROP COLUMN scope, DROP COLUMN owner_member_id,
      DROP COLUMN filter_rule, DROP COLUMN query_options, DROP COLUMN column_widths, DROP COLUMN revision;
    CREATE POLICY view_definitions_tenant_access ON view_upgrade.view_definitions TO crm_app USING (true);
    CREATE TABLE view_upgrade.object_definitions (LIKE public.object_definitions INCLUDING DEFAULTS);
    CREATE TABLE view_upgrade.record_follow_ups (LIKE public.record_follow_ups);
    CREATE TABLE view_upgrade.tenant_members (LIKE public.tenant_members INCLUDING INDEXES);
    CREATE VIEW view_upgrade.users AS SELECT * FROM public.users;
    CREATE VIEW view_upgrade.tenants AS SELECT * FROM public.tenants;
    INSERT INTO view_upgrade.object_definitions
      (tenant_id, code, name, title_field_key, status, active_publication_id, updated_at)
    VALUES
      (gen_random_uuid(), 'published', '报价', 'stage', 'ACTIVE', gen_random_uuid(), now()),
      (gen_random_uuid(), 'draft', '商机', 'stage', 'DRAFT', NULL, now());
    INSERT INTO view_upgrade.view_definitions
      (tenant_id, object_id, code, name, column_field_keys, sort, updated_at)
    SELECT tenant_id, id, 'default', '旧视图', '["stage","amount"]', '{"field":"amount","direction":"desc"}', now()
    FROM view_upgrade.object_definitions;
    ${migration}
    DO $check$
    BEGIN
      IF (SELECT count(*) FROM view_upgrade.view_definitions WHERE scope = 'DEFAULT'
          AND name = '旧视图' AND column_field_keys = '["stage","amount"]' AND sort = '{"field":"amount","direction":"desc"}') <> 2
        OR (SELECT array_agg(v.code::text ORDER BY v.code)
            FROM view_upgrade.view_definitions v JOIN view_upgrade.object_definitions o ON o.id = v.object_id
            WHERE v.scope = 'SHARED' AND o.code = 'published') IS DISTINCT FROM ARRAY['all', 'my_records', 'today_follow_up']
        OR EXISTS (SELECT 1 FROM view_upgrade.view_definitions v JOIN view_upgrade.object_definitions o ON o.id = v.object_id
                   WHERE o.code = 'draft' AND v.scope <> 'DEFAULT')
      THEN RAISE EXCEPTION 'Published and draft upgrade fixture failed'; END IF;
    END;
    $check$;
    ROLLBACK;
  `;
  execFileSync(
    "corepack",
    ["pnpm", "exec", "prisma", "db", "execute", "--stdin"],
    {
      cwd: new URL("../..", import.meta.url),
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL,
      },
      input: sql,
    },
  );
});
