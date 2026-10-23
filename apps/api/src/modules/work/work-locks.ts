import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';

/**
 * Locks the members a work write involves, in id order like every other
 * multi-member lock, and re-checks the actor inside the committing
 * transaction: still an ACTIVE member of an ACTIVE company with the role the
 * request was authorised for. NO KEY UPDATE serialises against member
 * changes without blocking other transactions' foreign-key checks.
 */
export async function lockWorkMembers(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  others: string[] = [],
): Promise<void> {
  for (const id of [...new Set([context.memberId, ...others])].sort())
    await tx.$queryRaw`SELECT id FROM tenant_members WHERE tenant_id=${context.tenantId}::uuid AND id=${id}::uuid FOR NO KEY UPDATE`;
  const [actor] = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT m.role FROM tenant_members m
    JOIN users u ON u.id = m.user_id
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = ${context.tenantId}::uuid AND m.id = ${context.memberId}::uuid
      AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND t.status = 'ACTIVE'`;
  if (!actor || actor.role !== context.role)
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}

/** A member who can receive work: ACTIVE in this company, with an ACTIVE account. */
export async function requireActiveMember(
  tx: Prisma.TransactionClient,
  tenantId: string,
  memberId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT m.id FROM tenant_members m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ${memberId}::uuid
      AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'`;
  if (!rows.length)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { assigneeMemberId: ['请选择在职成员。'] },
    });
}
