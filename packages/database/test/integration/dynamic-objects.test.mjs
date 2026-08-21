import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  createTestClients,
  migrateTestDatabase,
  resetTestData,
  withSettings,
} from "./helpers.mjs";

let admin;
let runtime;

before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});

beforeEach(async () => {
  await resetTestData(admin);
});

after(async () => {
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

test("published object configuration is tenant isolated and denied without context", async () => {
  const fixture = await createPublishedFixture();

  assert.deepEqual(await runtime.objectPublication.findMany(), []);

  const visible = await withSettings(
    runtime,
    { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
    (tx) =>
      tx.objectPublication.findMany({
        select: { tenantId: true, objectId: true, publicationNo: true },
      }),
  );

  assert.deepEqual(visible, [
    {
      tenantId: fixture.tenantA.id,
      objectId: fixture.objectA.id,
      publicationNo: 1,
    },
  ]);
  assert.ok(
    !visible.some(({ tenantId }) => tenantId === fixture.tenantB.id),
  );
});

test("published object configuration is immutable", async () => {
  const fixture = await createPublishedFixture();

  await assert.rejects(() =>
    admin.objectPublication.update({
      where: { id: fixture.publicationA.id },
      data: { changeSummary: { changed: true } },
    }),
  );
  await assert.rejects(() =>
    withSettings(
      runtime,
      { userId: fixture.userA.id, tenantId: fixture.tenantA.id },
      (tx) =>
        tx.objectPublication.delete({
          where: { id: fixture.publicationA.id },
        }),
    ),
  );
});

test("record counters allocate unique numbers under concurrency", async () => {
  const fixture = await createPublishedFixture();

  await admin.recordCounter.create({
    data: {
      tenantId: fixture.tenantA.id,
      objectId: fixture.objectA.id,
      nextRecordNo: 1n,
    },
  });

  const allocate = () =>
    admin.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT "next_record_no" FROM "record_counters"
         WHERE "tenant_id" = $1::uuid AND "object_id" = $2::uuid
         FOR UPDATE`,
        fixture.tenantA.id,
        fixture.objectA.id,
      );
      const allocated = BigInt(rows[0].next_record_no);
      await tx.recordCounter.update({
        where: {
          tenantId_objectId: {
            tenantId: fixture.tenantA.id,
            objectId: fixture.objectA.id,
          },
        },
        data: { nextRecordNo: allocated + 1n },
      });
      return allocated;
    });

  const allocated = await Promise.all([allocate(), allocate()]);
  assert.deepEqual(
    allocated.map(Number).sort((left, right) => left - right),
    [1, 2],
  );
});

async function createPublishedFixture() {
  const [userA, userB] = await Promise.all([
    createUser("+8613900000101", "配置管理员 A"),
    createUser("+8613900000102", "配置管理员 B"),
  ]);
  const [tenantA, tenantB] = await Promise.all([
    admin.tenant.create({ data: { name: "配置租户 A", code: "config-a" } }),
    admin.tenant.create({ data: { name: "配置租户 B", code: "config-b" } }),
  ]);
  const [memberA, memberB] = await Promise.all([
    createMember(tenantA.id, userA.id),
    createMember(tenantB.id, userB.id),
  ]);
  const [objectA, objectB] = await Promise.all([
    createObject(tenantA.id, "contacts-a"),
    createObject(tenantB.id, "contacts-b"),
  ]);
  const [fieldA, fieldB] = await Promise.all([
    createField(tenantA.id, objectA.id),
    createField(tenantB.id, objectB.id),
  ]);

  await Promise.all([
    createDraftConfiguration(tenantA.id, objectA.id, fieldA.id),
    createDraftConfiguration(tenantB.id, objectB.id, fieldB.id),
  ]);
  const [publicationA, publicationB] = await Promise.all([
    createPublication(tenantA.id, objectA.id, memberA.id, fieldA),
    createPublication(tenantB.id, objectB.id, memberB.id, fieldB),
  ]);
  await Promise.all([
    admin.objectDefinition.update({
      where: { id: objectA.id },
      data: {
        activePublicationId: publicationA.id,
        publishedAt: publicationA.publishedAt,
        status: "ACTIVE",
      },
    }),
    admin.objectDefinition.update({
      where: { id: objectB.id },
      data: {
        activePublicationId: publicationB.id,
        publishedAt: publicationB.publishedAt,
        status: "ACTIVE",
      },
    }),
  ]);

  return {
    fieldA,
    memberA,
    objectA,
    publicationA,
    tenantA,
    tenantB,
    userA,
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

function createField(tenantId, objectId) {
  return admin.fieldDefinition.create({
    data: {
      tenantId,
      objectId,
      fieldKey: "name",
      label: "姓名",
      type: "TEXT",
      required: true,
    },
  });
}

async function createDraftConfiguration(tenantId, objectId, fieldId) {
  await Promise.all([
    admin.viewDefinition.create({
      data: {
        tenantId,
        objectId,
        code: "default",
        name: "默认视图",
        type: "TABLE",
        columnFieldKeys: ["name"],
        sort: { field: "updatedAt", direction: "desc" },
      },
    }),
    admin.objectPermission.create({
      data: {
        tenantId,
        objectId,
        subjectType: "ROLE",
        subjectRole: "EMPLOYEE",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: "OWN",
        updateScope: "OWN",
      },
    }),
    admin.fieldPermission.create({
      data: {
        tenantId,
        objectId,
        fieldId,
        subjectRole: "EMPLOYEE",
        access: "EDIT",
      },
    }),
  ]);
}

function createPublication(tenantId, objectId, memberId, field) {
  return admin.objectPublication.create({
    data: {
      tenantId,
      objectId,
      publicationNo: 1,
      sourceDraftVersion: 1,
      configuration: {
        object: { id: objectId, code: "contacts", titleFieldKey: "name" },
        fields: [{ id: field.id, fieldKey: "name", type: "TEXT" }],
      },
      changeSummary: { changes: [{ kind: "ADDED", fieldKey: "name" }] },
      publishedByMemberId: memberId,
    },
  });
}
