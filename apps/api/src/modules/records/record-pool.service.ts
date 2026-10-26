import { lockObjectConfiguration } from '../objects/object-configuration-lock';
import {
  configOf,
  validatePoolConfig,
  analyzePoolProtectionSources,
} from './record-pool-config';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { isReadable } from '../objects/published-object.service';
import type { RecordRequestMeta } from './record-command';
import { type OwnershipInput, type PoolConfig } from './record-ownership';
import { lockMembers, lockObject } from './record-ownership-locks';
import { RECORDS_CLOCK } from './records.service';
import { applyOwnershipChange } from './record-ownership-command';

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
      await lockObjectConfiguration(tx, context.tenantId);
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
      const stored = configOf(object);
      const effective = {
        ...stored,
        enabled: input.enabled,
        lifecycleEnabled: input.lifecycleEnabled ?? stored.lifecycleEnabled,
        protectionRules: input.protectionRules ?? stored.protectionRules,
      };
      const sourceStates = new Map<string, string[]>();
      for (const rule of effective.enabled && effective.lifecycleEnabled
        ? (effective.protectionRules ?? [])
        : []) {
        const source = await resolvePublishedObjectInTransaction(
          tx,
          context,
          rule.sourceObjectCode,
        );
        sourceStates.set(
          rule.sourceObjectCode,
          source.schema.workflow?.states.map((state) => state.key) ?? [],
        );
      }
      const protectionIssues = analyzePoolProtectionSources(
        effective,
        sourceStates,
      );
      if (protectionIssues.length)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: protectionIssues.map((issue) => issue.message).join('；'),
        });
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
    return this.runner.withTenant(context, (tx) =>
      applyOwnershipChange(
        tx,
        { clock: this.clock, appendAudit: (t, e) => this.audit.append(t, e) },
        context,
        objectCode,
        recordId,
        input,
        meta,
      ),
    );
  }
}
