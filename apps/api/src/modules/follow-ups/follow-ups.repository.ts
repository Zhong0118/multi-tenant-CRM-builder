import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import type {
  CreateFollowUpDto,
  FollowUpQueryDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import type {
  FollowUpMeta,
  FollowUpScope,
  FollowUpRecordScope,
} from './follow-ups.service';

const include = { record: { include: { object: true } } } as const;
type Task = Prisma.RecordFollowUpGetPayload<{ include: typeof include }>;
function present(task: Task, canManage = true, now = new Date()) {
  return {
    id: task.id,
    recordId: task.recordId,
    recordTitle: task.record.title,
    objectCode: task.record.object.code,
    objectName: task.record.object.name,
    title: task.title,
    dueAt: task.dueAt.toISOString(),
    status: task.status,
    version: task.version,
    overdue: task.status === 'OPEN' && task.dueAt < now,
    canManage,
  };
}
@Injectable()
export class FollowUpsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}
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
          assigneeMemberId: context.memberId,
          record: { deletedAt: null },
        },
        include,
      });
      return item ? present(item) : null;
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
        assigneeMemberId: context.memberId,
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
          include,
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
          return present(item, canManage, now);
        }),
        total,
        openCount,
        overdueCount,
        page,
        limit,
      };
    });
  }
  create(
    context: TenantContext,
    input: CreateFollowUpDto,
    meta: FollowUpMeta,
    scope: FollowUpRecordScope,
  ) {
    return this.runner.withTenant(context, async (tx) => {
      await this.lockRecord(tx, context, scope);
      const item = await tx.recordFollowUp.create({
        data: {
          id: randomUUID(),
          tenantId: context.tenantId,
          assigneeMemberId: context.memberId,
          recordId: input.recordId,
          title: input.title,
          dueAt: new Date(input.dueAt),
        },
        include,
      });
      await this.log(tx, context, item.id, 'follow_up.created', meta, {
        title: item.title,
        dueAt: item.dueAt.toISOString(),
        recordId: item.recordId,
      });
      return present(item);
    });
  }
  update(
    context: TenantContext,
    id: string,
    input: UpdateFollowUpDto,
    meta: FollowUpMeta,
    scope: FollowUpRecordScope,
  ) {
    return this.runner.withTenant(context, async (tx) => {
      await this.lockRecord(tx, context, scope);
      const before = await tx.recordFollowUp.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId: context.memberId,
        },
      });
      const result = await tx.recordFollowUp.updateMany({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId: context.memberId,
          version: input.version,
          status: 'OPEN',
          record: { deletedAt: null },
        },
        data: {
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
        include,
      });
      await this.log(
        tx,
        context,
        id,
        input.status === 'DONE'
          ? 'follow_up.completed'
          : input.status === 'CANCELLED'
            ? 'follow_up.cancelled'
            : 'follow_up.rescheduled',
        meta,
        {
          status: item.status,
          dueAt: item.dueAt.toISOString(),
          version: item.version,
        },
        before
          ? {
              status: before.status,
              dueAt: before.dueAt.toISOString(),
              version: before.version,
            }
          : undefined,
      );
      return present(item);
    });
  }
  private async lockRecord(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    scope: FollowUpRecordScope,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM records WHERE tenant_id = ${context.tenantId}::uuid
        AND object_id = ${scope.objectId}::uuid AND id = ${scope.recordId}::uuid AND deleted_at IS NULL
        AND (${scope.requiredOwnerMemberId ?? null}::uuid IS NULL OR owner_member_id = ${scope.requiredOwnerMemberId ?? null}::uuid)
      FOR UPDATE
    `;
    if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
  }

  private log(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
    action: string,
    meta: FollowUpMeta,
    after: Record<string, unknown>,
    before?: Record<string, unknown>,
  ) {
    return this.audit.append(tx, {
      tenantId: context.tenantId,
      actorType: 'USER',
      actorId: context.userId,
      resourceType: 'record_follow_up',
      resourceId: id,
      action,
      after,
      before,
      ...meta,
    });
  }
}
