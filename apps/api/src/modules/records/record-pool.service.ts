import { configOf, validatePoolConfig } from './record-pool-config';
import { Inject, Injectable } from '@nestjs/common';
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
import {
  assertAssignableOwner,
  lockMembers,
  lockObject,
} from './record-ownership-locks';
import { RECORDS_CLOCK } from './records.service';

@Injectable()
export class RecordPoolService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    @Inject(RECORDS_CLOCK) private readonly clock: () => Date,
  ) {}

  getConfig(context: TenantContext, objectCode: string) {
    return this.runner.withTenant(context, async (tx) => {
      const resolved = await resolvePublishedObjectInTransaction(
        tx,
        context,
        objectCode,
      );
      if (!isReadable(resolved.schema, resolved.access))
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      const object = await tx.objectDefinition.findFirstOrThrow({
        where: { tenantId: context.tenantId, id: resolved.schema.object.id },
      });
      const base = {
        ...configOf(object),
        serverTime: this.clock().toISOString(),
        permissions: {
          canRead: resolved.access.canRead,
          canUpdate: resolved.access.canUpdate,
          readScope: resolved.access.readScope,
          updateScope: resolved.access.updateScope,
        },
      };
      if (context.role !== 'TENANT_ADMIN') return base;
      const where = {
        tenantId: context.tenantId,
        objectId: object.id,
        deletedAt: null,
      };
      const [legacyUnassigned, legacyPool, legacyOwned, expiredCount] =
        await Promise.all([
          tx.record.count({
            where: {
              ...where,
              poolStage: null,
              ownerMemberId: null,
              inPublicPool: false,
            },
          }),
          tx.record.count({
            where: { ...where, poolStage: null, inPublicPool: true },
          }),
          tx.record.count({
            where: { ...where, poolStage: null, ownerMemberId: { not: null } },
          }),
          tx.record.count({
            where: {
              ...where,
              ownerMemberId: { not: null },
              ownershipExpiresAt: { lte: this.clock() },
              OR: [{ poolStage: null }, { poolStage: { not: 'PROTECTED' } }],
            },
          }),
        ]);
      const sources = await tx.objectDefinition.findMany({
        where: {
          tenantId: context.tenantId,
          status: 'ACTIVE',
          deletedAt: null,
          activePublicationId: { not: null },
        },
        include: { activePublication: { select: { configuration: true } } },
      });
      const protectionSources = sources.flatMap((source) => {
        const configuration = source.activePublication?.configuration as {
          workflow?: { states?: Array<{ key: string; label: string }> };
        } | null;
        return configuration?.workflow?.states?.length
          ? [
              {
                objectCode: source.code,
                objectName: source.name,
                states: configuration.workflow.states.map((state) => ({
                  key: state.key,
                  label: state.label,
                })),
              },
            ]
          : [];
      });
      const employeeAccess = resolved.schema.employeeAccess;
      return {
        ...base,
        permissions: {
          canRead: employeeAccess?.canRead ?? false,
          canUpdate: employeeAccess?.canUpdate ?? false,
          readScope: employeeAccess?.readScope ?? 'NONE',
          updateScope: employeeAccess?.updateScope ?? 'NONE',
        },
        preview: { legacyUnassigned, legacyPool, legacyOwned, expiredCount },
        protectionSources,
      };
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
    validatePoolConfig(input);
    return this.runner.withTenant(context, async (tx) => {
      await lockMembers(tx, context);
      const object = await lockObject(tx, context, objectCode);
      if (object.poolConfigVersion !== input.version)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      if (
        input.lifecycleEnabled === false &&
        object.poolLifecycleEnabled &&
        (await tx.record.count({
          where: {
            tenantId: context.tenantId,
            objectId: object.id,
            deletedAt: null,
            poolStage: { not: null },
          },
        }))
      )
        throw new ApiException('VALIDATION_FAILED', 400, {
          message:
            '已有记录进入新版流转，不能切回旧模式。如需暂停，请关闭公共池并保留新版流转设置。',
        });
      for (const rule of input.protectionRules ?? []) {
        const source = await resolvePublishedObjectInTransaction(
          tx,
          context,
          rule.sourceObjectCode,
        );
        if (
          !source.schema.workflow ||
          rule.statusKeys.some(
            (key) =>
              !source.schema.workflow!.states.some(
                (state) => state.key === key,
              ),
          )
        )
          throw new ApiException('VALIDATION_FAILED', 400, {
            message: '保护依据必须选择来源表当前已发布流程中的状态。',
          });
      }
      const updated = await tx.objectDefinition.update({
        where: { id: object.id },
        data: {
          poolEnabled: input.enabled,
          poolOwnershipTtlHours: input.ownershipTtlHours,
          poolConfigVersion: { increment: 1 },
          ...(input.lifecycleEnabled === undefined
            ? {}
            : { poolLifecycleEnabled: input.lifecycleEnabled }),
          ...(input.contactTtlHours === undefined
            ? {}
            : { poolContactTtlHours: input.contactTtlHours }),
          ...(input.followUpTtlHours === undefined
            ? {}
            : { poolFollowUpTtlHours: input.followUpTtlHours }),
          ...(input.labels === undefined ? {} : { poolLabels: input.labels }),
          ...(input.protectionRules === undefined
            ? {}
            : {
                poolProtectionRules: input.protectionRules,
              }),
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
      if (input.action === 'ASSIGN' && input.ownerMemberId)
        await assertAssignableOwner(
          tx,
          context,
          objectCode,
          input.ownerMemberId,
        );
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
