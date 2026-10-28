import {
  recordOwnerFilter,
  recordOwnerMatches,
  type RecordOwnerFilter,
} from '../objects/record-read-scope';
import { lockRuntimeObjectConfiguration } from '../objects/object-configuration-lock';
import { resolveReadableObjectByIdInTransaction } from '../objects/published-object-transaction';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import type { RecordsRepository } from '../records/records.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import { createRecordActivityWithContactCommand } from '../records/record-command';
import { lockRecordActivityTarget } from '../records/record-ownership-locks';
import {
  appendFollowUpAudit,
  createFollowUpCommand,
  followUpInclude,
  lockFollowUpRecord,
  presentFollowUp,
  type FollowUpMeta,
  type FollowUpRecordScope,
  type FollowUpTask,
} from './follow-up-command';
import type {
  CreateFollowUpDto,
  FollowUpQueryDto,
  FollowUpWorkbenchResponseDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import type {
  AiFollowUpReadInput,
  AiFollowUpReadItem,
  FollowUpScope,
} from './follow-ups.service';
import type { FollowUpWorkbenchRange } from './follow-up-workbench-time';

/** §7.4: each preview bucket is capped, independently of the full counts. */
const WORKBENCH_PREVIEW_LIMIT = 5;

/**
 * One definition of "this actor may manage this Follow-up", shared by the list
 * page and the Workbench so the two permission surfaces cannot drift.
 */
function canManageRecord(
  scopes: FollowUpScope[],
  objectId: string,
  ownerMemberId: string | null,
): boolean {
  const scope = scopes.find((entry) => entry.objectId === objectId);
  return (
    !!scope?.canUpdate &&
    recordOwnerMatches(scope.ownerMemberId, ownerMemberId) &&
    (!scope.updateOwnerMemberId || scope.updateOwnerMemberId === ownerMemberId)
  );
}

@Injectable()
export class FollowUpsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    @Inject(RECORDS_REPOSITORY)
    private readonly records: RecordsRepository,
  ) {}
  async visibleFollowUpIdsInTransaction(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    ids: string[],
  ): Promise<string[]> {
    const items = await tx.recordFollowUp.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: [...new Set(ids)] },
        ...(context.role === 'TENANT_ADMIN'
          ? {}
          : { assigneeMemberId: context.memberId }),
      },
      select: { id: true },
    });
    return items.map((item) => item.id);
  }
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
        select: { id: true, ownerMemberId: true, inPublicPool: true },
      }),
    );
  }
  /**
   * The Workbench buckets by the tenant's calendar day, so the caller needs the
   * tenant zone before it can compute a range. `null` means "not configured"
   * and is reported as-is; the service decides to fail closed.
   */
  getTenantTimezone(context: TenantContext): Promise<string | null> {
    return this.runner.withTenant(context, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: context.tenantId },
        select: { timezone: true },
      });
      return tenant?.timezone ?? null;
    });
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
          object: { status: 'ACTIVE', deletedAt: null },
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
        items: items.map((item) =>
          presentFollowUp(
            item,
            canManageRecord(
              scopes,
              item.record.objectId,
              item.record.ownerMemberId,
            ),
            now,
          ),
        ),
        total,
        openCount,
        overdueCount,
        page,
        limit,
      };
    });
  }
  /**
   * Personal Workbench read model (§7): the current actor's own OPEN Follow-ups,
   * bucketed by the tenant calendar. The assignee is hard-bound to
   * `context.memberId` — the repository exposes no assignee argument — and every
   * query keeps the Record inside a readable object scope, so a Follow-up whose
   * Record the actor can no longer see disappears instead of leaking metadata.
   *
   * Four counts plus three bounded previews, all inside one tenant transaction.
   */
  workbench(
    context: TenantContext,
    scopes: FollowUpScope[],
    range: FollowUpWorkbenchRange,
    timezone: string,
  ): Promise<FollowUpWorkbenchResponseDto> {
    return this.runner.withTenant(context, async (tx) => {
      if (!scopes.length) {
        return {
          timezone,
          counts: { allOpen: 0, overdue: 0, today: 0, upcoming: 0 },
          preview: { overdue: [], today: [], upcoming: [] },
          pendingContacts: { count: 0, items: [] },
        };
      }

      const base: Prisma.RecordFollowUpWhereInput = {
        tenantId: context.tenantId,
        assigneeMemberId: context.memberId,
        status: 'OPEN',
        record: {
          tenantId: context.tenantId,
          deletedAt: null,
          object: { status: 'ACTIVE', deletedAt: null },
          OR: scopes.map((scope) => ({
            objectId: scope.objectId,
            ownerMemberId: scope.ownerMemberId,
          })),
        },
      };
      const overdueWhere: Prisma.RecordFollowUpWhereInput = {
        ...base,
        dueAt: { lt: range.now },
      };
      const todayWhere: Prisma.RecordFollowUpWhereInput = {
        ...base,
        dueAt: { gte: range.now, lt: range.tomorrowStart },
      };
      const upcomingWhere: Prisma.RecordFollowUpWhereInput = {
        ...base,
        dueAt: { gte: range.tomorrowStart, lt: range.day8Start },
      };
      const preview = (where: Prisma.RecordFollowUpWhereInput) =>
        tx.recordFollowUp.findMany({
          where,
          include: followUpInclude,
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: WORKBENCH_PREVIEW_LIMIT,
        });

      const [
        allOpen,
        overdue,
        today,
        upcoming,
        overdueRows,
        todayRows,
        upcomingRows,
      ] = await Promise.all([
        tx.recordFollowUp.count({ where: base }),
        tx.recordFollowUp.count({ where: overdueWhere }),
        tx.recordFollowUp.count({ where: todayWhere }),
        tx.recordFollowUp.count({ where: upcomingWhere }),
        preview(overdueWhere),
        preview(todayWhere),
        preview(upcomingWhere),
      ]);

      const project = (row: FollowUpTask, isOverdue: boolean) => ({
        id: row.id,
        recordId: row.recordId,
        recordTitle: row.record.title,
        objectCode: row.record.object.code,
        objectName: row.record.object.name,
        title: row.title,
        dueAt: row.dueAt.toISOString(),
        version: row.version,
        overdue: isOverdue,
        canManage: canManageRecord(
          scopes,
          row.record.objectId,
          row.record.ownerMemberId,
        ),
      });

      // Leads the actor claimed or was assigned and has not confirmed as
      // contacted, on readable tables running the staged pool.
      const pendingWhere: Prisma.RecordWhereInput = {
        tenantId: context.tenantId,
        ownerMemberId: context.memberId,
        poolStage: 'PENDING_CONTACT',
        deletedAt: null,
        objectId: { in: scopes.map((scope) => scope.objectId) },
        object: {
          status: 'ACTIVE',
          deletedAt: null,
          poolEnabled: true,
          poolLifecycleEnabled: true,
        },
      };
      const [pendingCount, pendingRows] = await Promise.all([
        tx.record.count({ where: pendingWhere }),
        tx.record.findMany({
          where: pendingWhere,
          select: {
            id: true,
            title: true,
            ownershipExpiresAt: true,
            object: { select: { code: true, name: true, poolLabels: true } },
          },
          orderBy: [{ ownershipExpiresAt: 'asc' }, { id: 'asc' }],
          take: WORKBENCH_PREVIEW_LIMIT,
        }),
      ]);

      return {
        timezone,
        counts: { allOpen, overdue, today, upcoming },
        preview: {
          overdue: overdueRows.map((row) => project(row, true)),
          today: todayRows.map((row) => project(row, false)),
          upcoming: upcomingRows.map((row) => project(row, false)),
        },
        pendingContacts: {
          count: pendingCount,
          items: pendingRows.flatMap((row) =>
            row.ownershipExpiresAt
              ? [
                  {
                    recordId: row.id,
                    recordTitle: row.title,
                    objectCode: row.object.code,
                    objectName: row.object.name,
                    stageLabel: pendingStageLabel(row.object.poolLabels),
                    expiresAt: row.ownershipExpiresAt.toISOString(),
                  },
                ]
              : [],
          ),
        },
      };
    });
  }
  /**
   * Personal AI read: the acting member's own Follow-ups on still-readable,
   * non-deleted records. Assignee is always `context.memberId`, including
   * Tenant Admin — there is no assignee argument.
   */
  listForAi(
    context: TenantContext,
    scopes: FollowUpScope[],
    input: AiFollowUpReadInput,
  ): Promise<AiFollowUpReadItem[]> {
    return this.runner.withTenant(context, async (tx) => {
      if (!scopes.length) return [];
      const now = new Date();
      const where: Prisma.RecordFollowUpWhereInput = {
        tenantId: context.tenantId,
        assigneeMemberId: context.memberId,
        status: input.status,
        dueAt: {
          ...(input.dueFrom ? { gte: new Date(input.dueFrom) } : {}),
          ...(input.dueTo ? { lte: new Date(input.dueTo) } : {}),
        },
        recordId: input.recordId,
        record: {
          tenantId: context.tenantId,
          deletedAt: null,
          object: { status: 'ACTIVE', deletedAt: null },
          OR: scopes.map((scope) => ({
            objectId: scope.objectId,
            ownerMemberId: scope.ownerMemberId,
          })),
        },
      };
      const items = await tx.recordFollowUp.findMany({
        where,
        include: followUpInclude,
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: input.limit,
      });
      return items.map((item) => ({
        id: item.id,
        objectCode: item.record.object.code,
        objectName: item.record.object.name,
        recordId: item.recordId,
        recordTitle: item.record.title,
        title: item.title,
        dueAt: item.dueAt.toISOString(),
        status: item.status,
        overdue: item.status === 'OPEN' && item.dueAt < now,
      }));
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
    return this.runner.withTenant(context, async (tx) => {
      await lockRuntimeObjectConfiguration(tx, context.tenantId);
      const { access } = await resolveReadableObjectByIdInTransaction(
        tx,
        context,
        scope.objectId,
        true,
      );
      const currentScope = {
        ...scope,
        requiredOwnerMemberId: recordOwnerFilter(
          access,
          context.memberId,
          true,
        ),
      };
      if (input.assigneeMemberId && input.assigneeMemberId !== context.memberId)
        await lockFollowUpRecipient(tx, context, input.assigneeMemberId, scope);
      return createFollowUpCommand(tx, context, input, meta, currentScope, {
        audit: this.audit,
      });
    });
  }
  update(
    context: TenantContext,
    id: string,
    input: UpdateFollowUpDto,
    meta: FollowUpMeta,
    scope: FollowUpRecordScope,
    recipientScope?: FollowUpRecordScope,
  ) {
    return this.records.withTenantTransaction(context, async (session) => {
      const { tx, store } = session;
      const resolved = await resolveReadableObjectByIdInTransaction(
        tx,
        context,
        scope.objectId,
        true,
      );
      const { access } = resolved;
      scope = {
        ...scope,
        requiredOwnerMemberId: recordOwnerFilter(
          access,
          context.memberId,
          true,
        ),
      };
      const completionRecord = input.completionResult
        ? await lockRecordActivityTarget(tx, context, resolved, scope.recordId)
        : null;
      if (!input.completionResult) {
        for (const memberId of [
          ...new Set(
            [context.memberId, input.assigneeMemberId].filter(
              (value): value is string => !!value,
            ),
          ),
        ].sort()) {
          const members = await tx.$queryRaw<
            Array<{ id: string; role: string }>
          >`SELECT m.id, m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${context.tenantId}::uuid AND m.id=${memberId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE' FOR NO KEY UPDATE OF m`;
          if (
            !members.length ||
            members[0].role !==
              (memberId === context.memberId
                ? context.role
                : recipientScope?.expectedRole)
          )
            throw new ApiException('WORKSPACE_FORBIDDEN', 403);
        }
      }
      await lockFollowUpRecord(tx, context, scope);
      if (recipientScope) await lockFollowUpRecord(tx, context, recipientScope);
      if (input.assigneeMemberId && input.assigneeMemberId !== context.memberId)
        await lockFollowUpRecipient(tx, context, input.assigneeMemberId, scope);
      const before = await tx.recordFollowUp.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          assigneeMemberId:
            context.role === 'TENANT_ADMIN' ? undefined : context.memberId,
        },
      });
      if (
        completionRecord &&
        resolved.poolEnabled &&
        resolved.poolLifecycleEnabled
      ) {
        if (
          ['PENDING_CONTACT', 'FOLLOWING'].includes(
            completionRecord.poolStage ?? '',
          ) &&
          (!completionRecord.ownershipExpiresAt ||
            completionRecord.ownershipExpiresAt <= new Date())
        )
          throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
            message: '持有期限已到，请刷新记录。',
          });
      }
      const completedAt = input.status === 'DONE' ? new Date() : null;
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
                completedAt,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return null;
      if (input.completionResult) {
        const { activity } = await createRecordActivityWithContactCommand(tx, {
          store,
          resolved,
          context,
          recordId: scope.recordId,
          input: input.completionResult,
          meta,
          clock: () => completedAt!,
          idGenerator: randomUUID,
        });
        await tx.recordFollowUp.update({
          where: { id, tenantId: context.tenantId },
          data: { completionActivityId: activity.id },
        });
      }
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

function pendingStageLabel(labels: Prisma.JsonValue): string {
  const pending =
    labels && typeof labels === 'object' && !Array.isArray(labels)
      ? (labels as Record<string, unknown>).pending
      : undefined;
  return typeof pending === 'string' && pending.trim() ? pending : '待联系';
}

/**
 * Re-checks inside the committing transaction that a member handed a task can
 * work on its record: ACTIVE, with current effective access that lets them
 * update the table, and owning the record where their scope is OWN. The checks
 * made before the transaction only chose the candidate; a permission or
 * ownership change since then is caught here. Member rows are locked in id
 * order, as every other multi-member lock does.
 */
async function lockFollowUpRecipient(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  recipientMemberId: string,
  scope: FollowUpRecordScope,
): Promise<void> {
  for (const id of [context.memberId, recipientMemberId].sort())
    await tx.$queryRaw`SELECT id FROM tenant_members WHERE tenant_id=${context.tenantId}::uuid AND id=${id}::uuid FOR NO KEY UPDATE`;
  const rows = await tx.$queryRaw<
    Array<{ role: TenantContext['role']; userId: string }>
  >`SELECT m.role, m.user_id AS "userId" FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${context.tenantId}::uuid AND m.id=${recipientMemberId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE'`;
  if (!rows.length)
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '请选择在职成员。',
    });
  const recipient: TenantContext = {
    ...context,
    memberId: recipientMemberId,
    userId: rows[0].userId,
    role: rows[0].role,
  };
  let ownerFilter: RecordOwnerFilter | undefined;
  try {
    const { access } = await resolveReadableObjectByIdInTransaction(
      tx,
      recipient,
      scope.objectId,
      true,
    );
    ownerFilter = recordOwnerFilter(access, recipientMemberId, true);
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '该成员没有这张表的处理权限，不能接收这条跟进。',
    });
  }
  try {
    await lockFollowUpRecord(tx, recipient, {
      ...scope,
      requiredOwnerMemberId: ownerFilter,
    });
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '该成员看不到这条记录，不能接收这条跟进。',
    });
  }
}
