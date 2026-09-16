import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import {
  appendFollowUpAudit,
  createFollowUpCommand,
  followUpInclude,
  lockFollowUpRecord,
  presentFollowUp,
  type FollowUpMeta,
  type FollowUpRecordScope,
} from './follow-up-command';
import type {
  CreateFollowUpDto,
  FollowUpQueryDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import type { FollowUpScope } from './follow-ups.service';

@Injectable()
export class FollowUpsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}
  activeMembers(context: TenantContext) {
    return this.runner.withTenant(context, (tx) =>
      tx.tenantMember.findMany({
        where: {
          tenantId: context.tenantId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
        include: { user: { select: { displayName: true } } },
      }),
    );
  }
  activeMember(context: TenantContext, id: string) {
    return this.runner.withTenant(context, (tx) =>
      tx.tenantMember.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      }),
    );
  }
  findRecord(context: TenantContext, objectId: string, recordId: string) {
    return this.runner.withTenant(context, (tx) =>
      tx.record.findFirst({
        where: {
          id: recordId,
          tenantId: context.tenantId,
          objectId,
          deletedAt: null,
        },
        select: { id: true, ownerMemberId: true },
      }),
    );
  }
  find(context: TenantContext, id: string) {
    return this.runner.withTenant(context, async (tx) => {
      const item = await tx.recordFollowUp.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId:
            context.role === 'TENANT_ADMIN' ? undefined : context.memberId,
          record: { deletedAt: null },
        },
        include: followUpInclude,
      });
      return item ? presentFollowUp(item) : null;
    });
  }
  list(
    context: TenantContext,
    scopes: FollowUpScope[],
    query: FollowUpQueryDto,
  ) {
    return this.runner.withTenant(context, async (tx) => {
      const now = new Date();
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const base: Prisma.RecordFollowUpWhereInput = {
        tenantId: context.tenantId,
        assigneeMemberId:
          context.role === 'TENANT_ADMIN' && query.recordId
            ? undefined
            : context.memberId,
        recordId: query.recordId,
        record: {
          tenantId: context.tenantId,
          deletedAt: null,
          OR: scopes.map((scope) => ({
            objectId: scope.objectId,
            ownerMemberId: scope.ownerMemberId,
          })),
        },
      };
      const where: Prisma.RecordFollowUpWhereInput = {
        ...base,
        status: query.status === 'OVERDUE' ? 'OPEN' : (query.status ?? 'OPEN'),
        ...(query.status === 'OVERDUE' ? { dueAt: { lt: now } } : {}),
      };
      const [items, total, openCount, overdueCount] = await Promise.all([
        tx.recordFollowUp.findMany({
          where,
          include: followUpInclude,
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.recordFollowUp.count({ where }),
        tx.recordFollowUp.count({ where: { ...base, status: 'OPEN' } }),
        tx.recordFollowUp.count({
          where: { ...base, status: 'OPEN', dueAt: { lt: now } },
        }),
      ]);
      return {
        items: items.map((item) => {
          const scope = scopes.find((s) => s.objectId === item.record.objectId);
          const canManage =
            !!scope?.canUpdate &&
            (!scope.updateOwnerMemberId ||
              scope.updateOwnerMemberId === item.record.ownerMemberId);
          return presentFollowUp(item, canManage, now);
        }),
        total,
        openCount,
        overdueCount,
        page,
        limit,
      };
    });
  }
  /**
   * Ordinary HTTP boundary: keeps its own tenant transaction and runs the
   * shared transaction-aware command inside it (§24).
   */
  create(
    context: TenantContext,
    input: CreateFollowUpDto,
    meta: FollowUpMeta,
    scope: FollowUpRecordScope,
  ) {
    return this.runner.withTenant(context, (tx) =>
      createFollowUpCommand(tx, context, input, meta, scope, {
        audit: this.audit,
      }),
    );
  }
  update(
    context: TenantContext,
    id: string,
    input: UpdateFollowUpDto,
    meta: FollowUpMeta,
    scope: FollowUpRecordScope,
    recipientScope?: FollowUpRecordScope,
  ) {
    return this.runner.withTenant(context, async (tx) => {
      for (const memberId of [
        ...new Set(
          [context.memberId, input.assigneeMemberId].filter(
            (value): value is string => !!value,
          ),
        ),
      ].sort()) {
        const members = await tx.$queryRaw<
          Array<{ id: string; role: string }>
        >`SELECT m.id, m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${context.tenantId}::uuid AND m.id=${memberId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m`;
        if (
          !members.length ||
          members[0].role !==
            (memberId === context.memberId
              ? context.role
              : recipientScope?.expectedRole)
        )
          throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      }
      await lockFollowUpRecord(tx, context, scope);
      if (recipientScope) await lockFollowUpRecord(tx, context, recipientScope);
      const before = await tx.recordFollowUp.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId:
            context.role === 'TENANT_ADMIN' ? undefined : context.memberId,
        },
      });
      const result = await tx.recordFollowUp.updateMany({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId:
            context.role === 'TENANT_ADMIN' ? undefined : context.memberId,
          version: input.version,
          status: 'OPEN',
          record: { deletedAt: null },
        },
        data: {
          ...(input.assigneeMemberId
            ? { assigneeMemberId: input.assigneeMemberId }
            : {}),
          ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
          ...(input.status
            ? {
                status: input.status,
                completedAt: input.status === 'DONE' ? new Date() : null,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return null;
      const item = await tx.recordFollowUp.findFirstOrThrow({
        where: { id, tenantId: context.tenantId },
        include: followUpInclude,
      });
      await appendFollowUpAudit(
        tx,
        this.audit,
        context,
        id,
        input.assigneeMemberId
          ? 'follow_up.reassigned'
          : input.status === 'DONE'
            ? 'follow_up.completed'
            : input.status === 'CANCELLED'
              ? 'follow_up.cancelled'
              : 'follow_up.rescheduled',
        meta,
        {
          assigneeMemberId: item.assigneeMemberId,
          status: item.status,
          dueAt: item.dueAt.toISOString(),
          version: item.version,
        },
        before
          ? {
              assigneeMemberId: before.assigneeMemberId,
              status: before.status,
              dueAt: before.dueAt.toISOString(),
              version: before.version,
            }
          : undefined,
      );
      return presentFollowUp(item);
    });
  }
}
