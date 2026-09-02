import { execFileSync } from "node:child_process";

import { createDatabaseClient } from "../../dist/index.js";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for database integration tests`);
  }

  return value;
}

export function migrateTestDatabase() {
  const adminUrl = requiredEnvironment("TEST_DATABASE_ADMIN_URL");

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: adminUrl,
    },
    stdio: "inherit",
  });
}

export function createTestClients() {
  return {
    admin: createDatabaseClient(requiredEnvironment("TEST_DATABASE_ADMIN_URL")),
    runtime: createDatabaseClient(requiredEnvironment("TEST_DATABASE_URL")),
  };
}

export async function resetTestData(admin) {
  await admin.objectDefinition.updateMany({
    data: { activePublicationId: null, publishedAt: null },
  });
  await admin.$transaction([
    admin.auditLog.deleteMany(),
    admin.record.deleteMany(),
    admin.recordCounter.deleteMany(),
    admin.fieldPermission.deleteMany(),
    admin.objectPermission.deleteMany(),
    admin.viewDefinition.deleteMany(),
    admin.objectPublication.deleteMany(),
    admin.fieldDefinition.deleteMany(),
    admin.objectDefinition.deleteMany(),
  ]);
  await resetBusinessTemplates(admin);
  await admin.tenant.updateMany({
    data: {
      defaultAdminDashboardId: null,
      defaultEmployeeDashboardId: null,
    },
  });
  await admin.tenantDashboardConfiguration.updateMany({
    data: { activePublicationId: null },
  });
  await admin.$transaction([
    admin.tenantDashboardPublication.deleteMany(),
    admin.tenantDashboardConfiguration.deleteMany(),
    admin.tenantInvitation.deleteMany(),
    admin.tenantMember.deleteMany(),
    admin.session.deleteMany(),
    admin.verificationChallenge.deleteMany(),
    admin.tenant.deleteMany(),
    admin.user.deleteMany(),
  ]);
}

export async function cleanupTestFixtures(
  admin,
  { tenantCodes = [], phones = [], templateCodes = [] },
) {
  const tenants = await admin.tenant.findMany({
    where: { code: { in: tenantCodes } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const templates = await admin.businessTemplate.findMany({
    where: { code: { in: templateCodes } },
    select: { id: true },
  });
  const templateIds = templates.map(({ id }) => id);

  if (tenantIds.length > 0) {
    await admin.auditLog.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.record.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.recordCounter.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.businessTemplateApplication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.objectDefinition.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await admin.fieldPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.objectPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.viewDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.objectPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.fieldDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.objectDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.tenant.updateMany({
      where: { id: { in: tenantIds } },
      data: {
        defaultAdminDashboardId: null,
        defaultEmployeeDashboardId: null,
      },
    });
    await admin.tenantDashboardConfiguration.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await admin.tenantDashboardPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.tenantDashboardConfiguration.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.tenantMember.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }

  if (templateIds.length > 0) {
    await admin.businessTemplateApplication.deleteMany({
      where: { templateVersion: { templateId: { in: templateIds } } },
    });
    await admin.businessTemplate.updateMany({
      where: { id: { in: templateIds } },
      data: { activeVersionId: null },
    });
    await admin.businessTemplateVersion.deleteMany({
      where: { templateId: { in: templateIds } },
    });
    await admin.businessTemplate.deleteMany({
      where: { id: { in: templateIds } },
    });
  }

  const users = await admin.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  await admin.session.deleteMany({ where: { userId: { in: userIds } } });
  await admin.verificationChallenge.deleteMany({
    where: { phone: { in: phones } },
  });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
}

async function resetBusinessTemplates(admin) {
  const rows = await admin.$queryRawUnsafe(
    "SELECT to_regclass('business_template_applications') IS NOT NULL AS exists",
  );

  if (!rows[0].exists) {
    return;
  }

  await admin.$executeRawUnsafe("DELETE FROM business_template_applications");
  await admin.$executeRawUnsafe(
    "UPDATE business_templates SET active_version_id = NULL",
  );
  await admin.$executeRawUnsafe("DELETE FROM business_template_versions");
  await admin.$executeRawUnsafe("DELETE FROM business_templates");
}

export function withSettings(client, { userId, tenantId }, work) {
  return client.$transaction(async (tx) => {
    if (userId) {
      await tx.$queryRawUnsafe(
        "SELECT set_config('app.user_id', $1, true)",
        userId,
      );
    }

    if (tenantId) {
      await tx.$queryRawUnsafe(
        "SELECT set_config('app.tenant_id', $1, true)",
        tenantId,
      );
    }

    return work(tx);
  });
}
