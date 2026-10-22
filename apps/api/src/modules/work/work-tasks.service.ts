import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { lockWorkMembers, requireActiveMember } from './work-locks';

export type WorkTaskStatus = 'OPEN' | 'DONE' | 'CANCELLED';

export interface WorkMeta {
  requestId: string;
  ip?: string;
}

const include = {
  assignee: { include: { user: { select: { displayName: true } } } },
  createdBy: { include: { user: { select: { displayName: true } } } },
} as const;
type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof include }>;

/**
 * General work tasks — 安排的工作, not tied to any customer record. Company
 * administrators assign them to any active member; every member can plan
 * tasks for themselves. The assignee completes a task and writes its result;
 * whoever assigned it, or any administrator, can change or cancel it. Every
 * rule that decides who may act is re-checked inside the committing
 * transaction, after locking the members involved.
 */
@Injectable()
export class WorkTasksService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  list(
    context: TenantContext,
    query: {
      scope?: 'mine' | 'team';
      status?: WorkTaskStatus;
      assigneeMemberId?: string;
      page: number;
      limit: number;
    },
  ) {
    const team = query.scope === 'team';
    if (team && context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner.withTenant(context, async (tx) => {
      const where: Prisma.WorkTaskWhereInput = {
        tenantId: context.tenantId,
        assigneeMemberId: team ? query.assigneeMemberId : context.memberId,
        status: query.status,
      };
      const [items, total] = await Promise.all([
        tx.workTask.findMany({
          where,
          include,
          // Open work first, soonest due first; finished work newest first.
          orderBy: [{ status: 'desc' }, { dueAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.workTask.count({ where }),
      ]);
      const now = new Date();
      return {
        items: items.map((task) => present(task, context, now)),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  }

  create(
    context: TenantContext,
    input: {
      title: string;
      notes?: string;
      dueAt: string;
      assigneeMemberId?: string;
    },
    meta: WorkMeta,
  ) {
    const assignee = input.assigneeMemberId ?? context.memberId;
    if (assignee !== context.memberId && context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403, {
        message: '只有公司管理员可以给其他成员安排任务。',
      });
    const fields = validated(input);
    return this.runner.withTenant(context, async (tx) => {
      await lockWorkMembers(tx, context, [assignee]);
      await requireActiveMember(tx, context.tenantId, assignee);
      const task = await tx.workTask.create({
        data: {
          tenantId: context.tenantId,
          assigneeMemberId: assignee,
          createdByMemberId: context.memberId,
          title: fields.title!,
          notes: fields.notes ?? '',
          dueAt: new Date(fields.dueAt!),
        },
        include,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'work_task.created',
        resourceType: 'work_task',
        resourceId: task.id,
        after: snapshot(task),
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return present(task, context, new Date());
    });
  }

  update(
    context: TenantContext,
    id: string,
    input: {
      version: number;
      title?: string;
      notes?: string;
      dueAt?: string;
      assigneeMemberId?: string;
      status?: WorkTaskStatus;
      result?: string;
    },
    meta: WorkMeta,
  ) {
    const fields = validated(input, true);
    return this.runner.withTenant(context, async (tx) => {
      const located = await tx.workTask.findFirst({
        where: { id, tenantId: context.tenantId },
        select: { assigneeMemberId: true },
      });
      if (!located) throw new ApiException('RECORD_NOT_FOUND', 404);
      await lockWorkMembers(
        tx,
        context,
        [located.assigneeMemberId, input.assigneeMemberId].filter(
          (value): value is string => !!value,
        ),
      );
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM work_tasks WHERE tenant_id=${context.tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
      if (!locked) throw new ApiException('RECORD_NOT_FOUND', 404);
      const before = await tx.workTask.findFirstOrThrow({
        where: { id, tenantId: context.tenantId },
        include,
      });
      const admin = context.role === 'TENANT_ADMIN';
      const isAssignee = before.assigneeMemberId === context.memberId;
      const isCreator = before.createdByMemberId === context.memberId;
      // Only people who can see the task learn it exists.
      if (!admin && !isAssignee && !isCreator)
        throw new ApiException('RECORD_NOT_FOUND', 404);
      if (before.version !== input.version)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);

      const manage = admin || isCreator;
      const changesPlan =
        fields.title !== undefined ||
        fields.notes !== undefined ||
        fields.dueAt !== undefined;
      if (changesPlan && !manage)
        throw forbidden('只有安排任务的人可以修改任务内容。');
      if (
        input.assigneeMemberId !== undefined &&
        input.assigneeMemberId !== before.assigneeMemberId
      ) {
        if (!admin) throw forbidden('只有公司管理员可以把任务转给其他成员。');
        await requireActiveMember(tx, context.tenantId, input.assigneeMemberId);
      }
      if (input.status === 'CANCELLED' && !manage)
        throw forbidden('只有安排任务的人可以取消任务。');
      if (
        (input.status === 'DONE' || input.status === 'OPEN') &&
        !isAssignee &&
        !admin
      )
        throw forbidden('只有负责人可以完成或重新打开任务。');
      if (fields.result !== undefined && !isAssignee && !admin)
        throw forbidden('只有负责人可以填写任务结果。');
      if (
        before.status === 'CANCELLED' &&
        input.status !== 'OPEN' &&
        input.status !== undefined
      )
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '已取消的任务只能重新打开。',
        });

      const status = input.status ?? before.status;
      const now = new Date();
      const updated = await tx.workTask.update({
        where: { id },
        data: {
          ...(fields.title !== undefined ? { title: fields.title } : {}),
          ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
          ...(fields.dueAt !== undefined
            ? { dueAt: new Date(fields.dueAt) }
            : {}),
          ...(fields.result !== undefined ? { result: fields.result } : {}),
          ...(input.assigneeMemberId !== undefined
            ? { assigneeMemberId: input.assigneeMemberId }
            : {}),
          status,
          completedAt:
            status === 'DONE'
              ? before.status === 'DONE'
                ? before.completedAt
                : now
              : null,
          version: { increment: 1 },
        },
        include,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action:
          status !== before.status
            ? `work_task.${status === 'DONE' ? 'completed' : status === 'CANCELLED' ? 'cancelled' : 'reopened'}`
            : updated.assigneeMemberId !== before.assigneeMemberId
              ? 'work_task.reassigned'
              : 'work_task.updated',
        resourceType: 'work_task',
        resourceId: id,
        before: snapshot(before),
        after: snapshot(updated),
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return present(updated, context, now);
    });
  }
}

function forbidden(message: string) {
  return new ApiException('OBJECT_ACTION_FORBIDDEN', 403, { message });
}

function validated(
  input: { title?: string; notes?: string; dueAt?: string; result?: string },
  partial = false,
) {
  const title = input.title?.trim();
  const errors: Record<string, string[]> = {};
  if ((!partial || input.title !== undefined) && (!title || title.length > 200))
    errors.title = ['请填写 1 至 200 字的任务标题。'];
  if (
    (!partial || input.dueAt !== undefined) &&
    (!input.dueAt || !Number.isFinite(Date.parse(input.dueAt)))
  )
    errors.dueAt = ['请选择截止时间。'];
  for (const key of ['notes', 'result'] as const)
    if ((input[key]?.length ?? 0) > 4000) errors[key] = ['不能超过 4000 字。'];
  if (Object.keys(errors).length)
    throw new ApiException('VALIDATION_FAILED', 400, { fieldErrors: errors });
  return {
    title,
    notes: input.notes,
    dueAt: input.dueAt,
    result: input.result,
  };
}

function memberName(member: TaskRow['assignee']): string {
  return member.displayName ?? member.user.displayName ?? '成员';
}

function snapshot(task: TaskRow) {
  return {
    title: task.title,
    assigneeMemberId: task.assigneeMemberId,
    dueAt: task.dueAt.toISOString(),
    status: task.status,
    version: task.version,
  };
}

function present(task: TaskRow, context: TenantContext, now: Date) {
  const admin = context.role === 'TENANT_ADMIN';
  const isAssignee = task.assigneeMemberId === context.memberId;
  const isCreator = task.createdByMemberId === context.memberId;
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt.toISOString(),
    status: task.status as WorkTaskStatus,
    result: task.result,
    completedAt: task.completedAt?.toISOString() ?? null,
    overdue: task.status === 'OPEN' && task.dueAt.getTime() < now.getTime(),
    assigneeMemberId: task.assigneeMemberId,
    assigneeName: memberName(task.assignee),
    createdByMemberId: task.createdByMemberId,
    createdByName: memberName(task.createdBy),
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    canComplete: isAssignee || admin,
    canManage: isCreator || admin,
    canReassign: admin,
  };
}
