import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";
let admin, runtime;
before(() => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
});
after(async () => {
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});
test("template-backed workflows accept no author, require a real source and retain tenant RLS", async () => {
  const f = await admin.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phone: "+t" + randomUUID().slice(0, 20),
        displayName: "Template author",
        passwordHash: "test",
        phoneVerifiedAt: new Date(),
        isPlatformAdmin: true,
      },
    });
    const tenant = await tx.tenant.create({
      data: { code: "provenance-" + randomUUID(), name: "No members" },
    });
    const template = await tx.businessTemplate.create({
      data: {
        code: "provenance-" + randomUUID(),
        name: "Portable",
        createdByUserId: user.id,
        draftConfiguration: { schemaVersion: 1, objects: [] },
      },
    });
    const version = await tx.businessTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNo: 1,
        sourceDraftVersion: 1,
        schemaVersion: 1,
        configuration: { schemaVersion: 1, objects: [] },
        configurationChecksum: "a".repeat(64),
        changeSummary: [],
        publishedByUserId: user.id,
      },
    });
    const object = await tx.objectDefinition.create({
      data: {
        tenantId: tenant.id,
        code: "customers",
        name: "Customers",
        titleFieldKey: "name",
        sourceTemplateVersionId: version.id,
      },
    });
    return { user, tenant, template, version, object };
  });
  try {
    const [workflow] = await withSettings(
      runtime,
      { userId: f.user.id, tenantId: f.tenant.id },
      (tx) =>
        tx.$queryRawUnsafe(
          "INSERT INTO object_workflow_definitions(tenant_id,object_definition_id,source_template_version_id,updated_at) VALUES ($1::uuid,$2::uuid,$3::uuid,now()) RETURNING created_by_member_id,updated_by_member_id",
          f.tenant.id,
          f.object.id,
          f.version.id,
        ),
    );
    assert.equal(workflow.created_by_member_id, null);
    assert.equal(workflow.updated_by_member_id, null);
    assert.equal(
      await admin.tenantMember.count({ where: { tenantId: f.tenant.id } }),
      0,
    );
    await assert.rejects(() =>
      admin.$executeRawUnsafe(
        "UPDATE object_workflow_definitions SET source_template_version_id=NULL WHERE object_definition_id=$1::uuid",
        f.object.id,
      ),
    );
    await assert.rejects(() =>
      admin.$executeRawUnsafe(
        "UPDATE object_workflow_definitions SET source_template_version_id=$1::uuid WHERE object_definition_id=$2::uuid",
        randomUUID(),
        f.object.id,
      ),
    );
    assert.equal((await runtime.objectWorkflowDefinition.findMany()).length, 0);
    const tenantRole = await withSettings(
      runtime,
      { tenantId: f.tenant.id },
      (tx) =>
        tx.businessTemplateVersion.findMany({ where: { id: f.version.id } }),
    );
    assert.deepEqual(tenantRole, []);
  } finally {
    await admin.objectWorkflowDefinition.deleteMany({
      where: { tenantId: f.tenant.id },
    });
    await admin.objectDefinition.delete({ where: { id: f.object.id } });
    await admin.businessTemplateVersion.delete({ where: { id: f.version.id } });
    await admin.businessTemplate.delete({ where: { id: f.template.id } });
    await admin.tenant.delete({ where: { id: f.tenant.id } });
    await admin.user.delete({ where: { id: f.user.id } });
  }
});
