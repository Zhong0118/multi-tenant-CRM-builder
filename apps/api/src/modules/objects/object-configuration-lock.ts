import type { Prisma } from '@crm/database';

/** Serialize changes that can add/remove cross-object runtime dependencies. */
export async function lockObjectConfiguration(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  // ponytail: tenant-wide admin lock; split by dependency graph only if measured contention warrants it.
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId} || ':object-configuration', 0))::text`;
}
