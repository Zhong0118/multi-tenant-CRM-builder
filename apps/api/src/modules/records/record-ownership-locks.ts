import { isReadable } from '../objects/published-object.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import type { Prisma } from '@crm/database';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';

export async function lockObject(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  code: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM object_definitions WHERE tenant_id = ${context.tenantId}::uuid AND code = ${code} AND status = 'ACTIVE' AND deleted_at IS NULL AND active_publication_id IS NOT NULL FOR NO KEY UPDATE`;
  if (!rows.length) {
    // Preserve the common resolver's authorization-aware archived explanation.
    await resolvePublishedObjectInTransaction(tx, context, code);
    throw new ApiException('OBJECT_NOT_FOUND', 404);
  }
  return tx.objectDefinition.findFirstOrThrow({
    where: { id: rows[0].id, tenantId: context.tenantId },
  });
}

export async function lockMembers(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  target?: string,
) {
  for (const id of [
    ...new Set([context.memberId, ...(target ? [target] : [])]),
  ].sort()) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; role: string; userId: string }>
    >`SELECT m.id, m.role, m.user_id AS "userId" FROM tenant_members m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id WHERE m.tenant_id = ${context.tenantId}::uuid AND m.id = ${id}::uuid AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND t.status = 'ACTIVE' FOR UPDATE OF m, u`;
    if (!rows.length)
      throw new ApiException(
        id === context.memberId ? 'WORKSPACE_FORBIDDEN' : 'OWNER_INVALID',
        id === context.memberId ? 403 : 400,
      );
    if (
      id === context.memberId &&
      (rows[0].role !== context.role || rows[0].userId !== context.userId)
    )
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
  }
}

export async function assertAssignableOwner(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  code: string,
  memberId: string,
) {
  const target = await tx.tenantMember.findFirst({
    where: {
      tenantId: context.tenantId,
      id: memberId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
  });
  if (!target) throw new ApiException('OWNER_INVALID', 400);
  const resolved = await resolvePublishedObjectInTransaction(
    tx,
    {
      ...context,
      memberId: target.id,
      userId: target.userId,
      role: target.role,
    },
    code,
  );
  if (
    !isReadable(resolved.schema, resolved.access) ||
    !resolved.access.canUpdate ||
    resolved.access.readScope === 'NONE' ||
    resolved.access.updateScope === 'NONE'
  )
    throw new ApiException('OWNER_INVALID', 400, {
      message: '目标成员需具有该业务表的读取和处理权限。',
    });
}
