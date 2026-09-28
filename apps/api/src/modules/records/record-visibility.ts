import type { Prisma } from '@crm/database';
import type { TenantContext } from '../../common/tenancy/tenant-context';

/** Read-only, caller-transaction visibility seam for proposal history. */
export async function visibleRecordIdsInTransaction(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectId: string,
  ids: string[],
  ownerMemberId?: string,
): Promise<string[]> {
  const rows = await tx.record.findMany({
    where: {
      tenantId: context.tenantId,
      objectId,
      id: { in: [...new Set(ids)] },
      deletedAt: null,
      ...(ownerMemberId ? { ownerMemberId } : {}),
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
