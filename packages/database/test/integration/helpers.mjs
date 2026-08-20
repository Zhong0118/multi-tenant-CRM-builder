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
  await admin.$transaction([
    admin.auditLog.deleteMany(),
    admin.record.deleteMany(),
    admin.fieldDefinition.deleteMany(),
    admin.objectDefinition.deleteMany(),
    admin.tenantInvitation.deleteMany(),
    admin.tenantMember.deleteMany(),
    admin.session.deleteMany(),
    admin.verificationChallenge.deleteMany(),
    admin.tenant.deleteMany(),
    admin.user.deleteMany(),
  ]);
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
