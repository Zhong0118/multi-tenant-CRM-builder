import { ApiException } from '../../common/errors/api.exception';
import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { findPublishedObjectInTransaction } from './published-object.repository';
import {
  resolvePublishedObjectRecord,
  isReadable,
  type ResolvedObjectSchema,
} from './published-object.service';

/**
 * §25 / §46.3: resolves a Target Object's CURRENT Active Publication and the
 * Actor's Effective Access inside a transaction the caller already owns, so a
 * Transition, its Actions, History and Audit commit or roll back together
 * (§4 / §24). It never opens or nests a transaction.
 *
 * It deliberately does NOT impose the UI read gate: a Transition may legally
 * create a record in an object the Actor can create but cannot read
 * (`canCreate = true`, `canRead = false`). Nothing is elevated here — the
 * consuming domain command still checks `canCreate`/`canUpdate` and field
 * permission (§5 / §18), and no Target record data is returned.
 */
export async function resolvePublishedObjectInTransaction(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectCode: string,
): Promise<ResolvedObjectSchema> {
  const record = await findPublishedObjectInTransaction(
    tx,
    context,
    objectCode,
  );
  return resolvePublishedObjectRecord(record, context.role);
}

/** Caller holds the shared runtime gate before any actor/record lock. */
export async function resolveReadableObjectByIdInTransaction(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectId: string,
  write = false,
): Promise<ResolvedObjectSchema> {
  const object = await tx.objectDefinition.findFirst({
    where: { tenantId: context.tenantId, id: objectId, deletedAt: null },
    select: { code: true },
  });
  if (!object) throw new ApiException('OBJECT_NOT_FOUND', 404);
  const resolved = await resolveReadablePublishedObjectInTransaction(
    tx,
    context,
    object.code,
  );
  if (
    write &&
    (!resolved.access.canUpdate || resolved.access.updateScope === 'NONE')
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  return resolved;
}

export async function resolveReadablePublishedObjectInTransaction(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  objectCode: string,
): Promise<ResolvedObjectSchema> {
  const resolved = await resolvePublishedObjectInTransaction(
    tx,
    context,
    objectCode,
  );
  if (!isReadable(resolved.schema, resolved.access))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  return resolved;
}
