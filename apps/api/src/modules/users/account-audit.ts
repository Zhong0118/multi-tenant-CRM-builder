import type { Prisma } from '@crm/database';

export function appendAccountAudit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  meta: { requestId: string; ip?: string },
  after?: Prisma.InputJsonObject,
) {
  // An ordinary employee can insert an account audit but cannot SELECT it via RETURNING.
  return tx.auditLog.createMany({
    data: {
      actorType: 'USER',
      actorId: userId,
      resourceType: 'user',
      resourceId: userId,
      action,
      after,
      ...meta,
    },
  });
}
