import { randomUUID } from 'node:crypto';

import { normalizeChineseMobile } from '../modules/auth/phone-number';

async function main(): Promise<void> {
  const phone = normalizeChineseMobile(requiredArgument('--phone'));
  const reason = requiredArgument('--reason');
  const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required');

  const { createDatabaseClient } = await import('@crm/database');
  const database = createDatabaseClient(databaseUrl);
  try {
    const changed = await database.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { phone } });
      if (!user || user.status !== 'ACTIVE' || !user.phoneVerifiedAt) {
        throw new Error('A verified active user is required');
      }
      if (user.isPlatformAdmin) return false;

      await transaction.user.update({
        where: { id: user.id },
        data: { isPlatformAdmin: true },
      });
      await transaction.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'platform.admin.granted',
          resourceType: 'user',
          resourceId: user.id,
          after: { isPlatformAdmin: true },
          reason,
          requestId: `cli_${randomUUID()}`,
        },
      });
      return true;
    });
    process.stdout.write(
      changed
        ? 'Platform administrator granted.\n'
        : 'User is already a platform administrator.\n',
    );
  } finally {
    await database.$disconnect();
  }
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
