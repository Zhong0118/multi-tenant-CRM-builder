import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { isReadable } from '../objects/published-object.service';
import type { RecordRequestMeta } from './record-command';
import {
  ownershipChange,
  type OwnershipInput,
  type PoolConfig,
} from './record-ownership';
import { RECORDS_CLOCK } from './records.service';

@Injectable()
export class RecordPoolService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    @Inject(RECORDS_CLOCK) private readonly clock: () => Date,
  ) {}

  getConfig(context: TenantContext, objectCode: string): Promise<PoolConfig> {
    return this.runner.withTenant(context, async (tx) => {
      const resolved = await resolvePublishedObjectInTransaction(
        tx,
        context,
        objectCode,
      );
      if (!isReadable(resolved.schema, resolved.access))
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      return configOf(
        await tx.objectDefinition.findFirstOrThrow({
          where: { tenantId: context.tenantId, id: resolved.schema.object.id },
        }),
      );
    });
  }

  updateConfig(
    context: TenantContext,
    objectCode: string,
    input: PoolConfig,
    meta: RecordRequestMeta,
  ): Promise<PoolConfig> {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    if (
      typeof input.enabled !== 'boolean' ||
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      (input.ownershipTtlHours !== null &&
        (!Number.isInteger(input.ownershipTtlHours) ||
          input.ownershipTtlHours < 1 ||
          input.ownershipTtlHours > 8760))
    ) {
      throw new ApiException('VALIDATION_FAILED', 400);
    }
    return this.runner.withTenant(context, async (tx) => {
      await lockMembers(tx, context);
      const object = await lockObject(tx, context, objectCode);
      if (object.poolConfigVersion !== input.version)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      const updated = await tx.objectDefinition.update({
        where: { id: object.id },
        data: {
          poolEnabled: input.enabled,
          poolOwnershipTtlHours: input.ownershipTtlHours,
          poolConfigVersion: { increment: 1 },
        },
      });
      const result = configOf(updated);
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'object.pool_config_updated',
        resourceType: 'object',
        resourceId: object.id,
        before: { ...configOf(object) },
        after: { ...result },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return result;
    });
  }

  changeOwnership(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    input: OwnershipInput,
    meta: RecordRequestMeta,
  ) {
    return this.runner.withTenant(context, async (tx) => {
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
        this.clock(),
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
          ownerMemberId: change.ownerMemberId,
          inPublicPool: change.inPublicPool,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      // The database owner-change trigger clears the old owner's lease for every
      // mutation path. This explicit command starts the new lease after that reset.
      await tx.record.update({
        where: { id: recordId },
        data: { ownershipExpiresAt: change.ownershipExpiresAt },
      });
      await this.audit.append(tx, {
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
    });
  }
}

function configOf(object: {
  poolEnabled: boolean;
  poolOwnershipTtlHours: number | null;
  poolConfigVersion: number;
}): PoolConfig {
  return {
    enabled: object.poolEnabled,
    ownershipTtlHours: object.poolOwnershipTtlHours,
    version: object.poolConfigVersion,
  };
}

async function lockObject(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  code: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM object_definitions WHERE tenant_id = ${context.tenantId}::uuid AND code = ${code} AND status = 'ACTIVE' AND deleted_at IS NULL AND active_publication_id IS NOT NULL FOR UPDATE`;
  if (!rows.length) throw new ApiException('OBJECT_NOT_FOUND', 404);
  return tx.objectDefinition.findFirstOrThrow({
    where: { id: rows[0].id, tenantId: context.tenantId },
  });
}

async function lockMembers(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  target?: string,
) {
  for (const id of [
    ...new Set([context.memberId, ...(target ? [target] : [])]),
  ].sort()) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; role: string; userId: string }>
    >`SELECT m.id, m.role, m.user_id AS "userId" FROM tenant_members m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id WHERE m.tenant_id = ${context.tenantId}::uuid AND m.id = ${id}::uuid AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND t.status = 'ACTIVE' FOR SHARE OF m, u`;
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
