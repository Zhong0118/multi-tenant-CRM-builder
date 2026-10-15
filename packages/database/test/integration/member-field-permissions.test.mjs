import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  cleanupTestFixtures,
  createTestClients,
  withSettings,
} from "./helpers.mjs";

const tenantCodes = ["member-field-test-a", "member-field-test-b"];
const phones = ["+8613900000191", "+8613900000192"];
let admin;
let runtime;
before(async () => {
  ({ admin, runtime } = createTestClients());
  await cleanupTestFixtures(admin, { tenantCodes, phones });
});
after(async () => {
  await cleanupTestFixtures(admin, { tenantCodes, phones });
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

test("member field exceptions enforce tenant RLS, composite foreign keys and uniqueness", async () => {
  const fixtures = [];
  for (let i = 0; i < 2; i++) {
    const user = await admin.user.create({
      data: {
        phone: phones[i],
        passwordHash: "test-hash",
        phoneVerifiedAt: new Date(),
        displayName: "Field access",
      },
    });
    const tenant = await admin.tenant.create({
      data: { code: tenantCodes[i], name: tenantCodes[i], status: "ACTIVE" },
    });
    const member = await admin.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id, role: "EMPLOYEE" },
    });
    const object = await admin.objectDefinition.create({
      data: {
        tenantId: tenant.id,
        code: "leads",
        name: "Leads",
        titleFieldKey: "name",
      },
    });
    const field = await admin.fieldDefinition.create({
      data: {
        tenantId: tenant.id,
        objectId: object.id,
        fieldKey: "name",
        label: "Name",
        type: "TEXT",
      },
    });
    fixtures.push({ user, tenant, member, object, field });
  }
  const [a, b] = fixtures;
  const data = {
    tenantId: a.tenant.id,
    objectId: a.object.id,
    fieldId: a.field.id,
    memberId: a.member.id,
    access: "READ_ONLY",
  };
  await withSettings(
    runtime,
    { tenantId: a.tenant.id, userId: a.user.id },
    (tx) => tx.memberFieldPermission.create({ data }),
  );
  assert.deepEqual(await runtime.memberFieldPermission.findMany(), []);
  assert.deepEqual(
    await withSettings(
      runtime,
      { tenantId: b.tenant.id, userId: b.user.id },
      (tx) => tx.memberFieldPermission.findMany(),
    ),
    [],
  );
  await assert.rejects(() =>
    withSettings(runtime, { tenantId: b.tenant.id, userId: b.user.id }, (tx) =>
      tx.memberFieldPermission.create({ data }),
    ),
  );
  await assert.rejects(() => admin.memberFieldPermission.create({ data }), {
    code: "P2002",
  });
  for (const invalid of [
    { memberId: b.member.id },
    { objectId: b.object.id },
    { fieldId: b.field.id },
  ]) {
    await assert.rejects(
      () =>
        admin.memberFieldPermission.create({ data: { ...data, ...invalid } }),
      { code: "P2003" },
    );
  }
  const otherObject = await admin.objectDefinition.create({
    data: {
      tenantId: a.tenant.id,
      code: "customers",
      name: "Customers",
      titleFieldKey: "name",
    },
  });
  await assert.rejects(
    () =>
      admin.memberFieldPermission.create({
        data: { ...data, objectId: otherObject.id },
      }),
    { code: "P2003" },
  );
  const changed = await withSettings(
    runtime,
    { tenantId: a.tenant.id, userId: a.user.id },
    (tx) =>
      tx.memberFieldPermission.updateMany({
        where: { memberId: a.member.id },
        data: { access: "EDIT" },
      }),
  );
  assert.equal(changed.count, 1);
  const deleted = await withSettings(
    runtime,
    { tenantId: a.tenant.id, userId: a.user.id },
    (tx) =>
      tx.memberFieldPermission.deleteMany({ where: { memberId: a.member.id } }),
  );
  assert.equal(deleted.count, 1);
});
