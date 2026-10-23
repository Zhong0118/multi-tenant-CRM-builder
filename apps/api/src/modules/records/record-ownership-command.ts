import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import { lockRuntimeObjectConfiguration } from '../objects/object-configuration-lock';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { isReadable } from '../objects/published-object.service';
import type { RecordRequestMeta } from './record-command';
import { configOf } from './record-pool-config';
import { ownershipChange, type OwnershipInput } from './record-ownership';
import {
  assertAssignableOwner,
  lockMembers,
  lockObject,
} from './record-ownership-locks';

export interface OwnershipCommandDeps {
  clock: () => Date;
  appendAudit: (
    tx: Prisma.TransactionClient,
    event: AuditEvent,
  ) => Promise<unknown>;
}

/**
 * The one implementation of the staged pool's state machine — claim, assign,
 * confirm contact, release, unprotect — run inside the caller's tenant
 * transaction. The pool's own endpoint and an activity that records a
 * successful contact both come here, so they share locks (gate, members,
 * table, record), checks, deadlines and audit.
 */
export async function applyOwnershipChange(
  tx: Prisma.TransactionClient,
  { clock, appendAudit }: OwnershipCommandDeps,
  context: TenantContext,
  objectCode: string,
  recordId: string,
  input: OwnershipInput,
  meta: RecordRequestMeta,
): Promise<{ recordId: string; version: number }> {
  await lockRuntimeObjectConfiguration(tx, context.tenantId);
  await lockMembers(
    tx,
    context,
    input.action === 'ASSIGN' ? input.ownerMemberId : undefined,
  );
  const object = await lockObject(tx, context, objectCode);
  const resolved = await resolvePublishedObjectInTransaction(
    tx,
    context,
    objectCode,
  );
  if (!isReadable(resolved.schema, resolved.access))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  if (input.action === 'ASSIGN' && input.ownerMemberId)
    await assertAssignableOwner(tx, context, objectCode, input.ownerMemberId);
  const locked = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM records WHERE tenant_id = ${context.tenantId}::uuid AND object_id = ${object.id}::uuid AND id = ${recordId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (!locked.length) throw new ApiException('RECORD_NOT_FOUND', 404);
  const record = await tx.record.findFirstOrThrow({
    where: {
      tenantId: context.tenantId,
      id: recordId,
      objectId: object.id,
      deletedAt: null,
    },
  });
  const change = ownershipChange(
    context,
    resolved.access,
    configOf(object),
    record,
    input,
    clock(),
  );
  const updated = await tx.record.updateMany({
    where: {
      tenantId: context.tenantId,
      objectId: object.id,
      id: recordId,
      version: input.version,
      deletedAt: null,
    },
    data: {
      ...change,
      ownershipExpiresAt: undefined,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1)
    throw new ApiException('RECORD_VERSION_CONFLICT', 409);
  // The database owner-change trigger clears the old owner's lease for every
  // mutation path. This explicit command starts the new lease after that reset.
  await tx.record.update({
    where: { id: recordId },
    data: { ...change },
  });
  await appendAudit(tx, {
    tenantId: context.tenantId,
    actorType: 'USER',
    actorId: context.userId,
    action: `record.ownership_${input.action.toLowerCase()}`,
    resourceType: 'record',
    resourceId: recordId,
    before: {
      ownerMemberId: record.ownerMemberId,
      inPublicPool: record.inPublicPool,
      ownershipExpiresAt: record.ownershipExpiresAt?.toISOString() ?? null,
      version: record.version,
    },
    after: {
      ...change,
      ownershipExpiresAt: change.ownershipExpiresAt?.toISOString() ?? null,
      version: input.version + 1,
    },
    requestId: meta.requestId,
    ip: meta.ip,
  });
  return { recordId, version: input.version + 1 };
}
