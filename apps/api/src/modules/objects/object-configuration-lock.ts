import type { Prisma } from '@crm/database';

/** Serialize changes that can add/remove cross-object runtime dependencies. */
export async function lockObjectConfiguration(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  // ponytail: tenant-wide admin lock; split by dependency graph only if measured contention warrants it.
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId} || ':object-configuration', 0))::text`;
}

/** Runtime transactions hold this before actor/record locks, until commit.
 * The shared tenant gate covers all workflow targets without late lock upgrades.
 */
export async function lockRuntimeObjectConfiguration(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${tenantId} || ':object-configuration', 0))::text`;
}
