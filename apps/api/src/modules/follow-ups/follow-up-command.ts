import { randomUUID } from 'node:crypto';

import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditService } from '../audit/audit.service';

/**
 * §22 / §24: the transaction-aware `CREATE_FOLLOW_UP` command.
 *
 * The command never opens a transaction: the caller owns the tenant
 * transaction and hands in the `Prisma.TransactionClient`, so a Transition, its
 * Actions, its History and its Audit commit or roll back together (§4). The
 * ordinary HTTP repository opens the same command inside its existing
 * `runner.withTenant(…)` boundary.
 *
 * The projection, the two `FOR UPDATE` locks and the audit event live here
 * because the ordinary read paths (`find`, `list`, `update`) and the command
 * must not drift into two copies.
 */

export const followUpInclude = {
  record: { include: { object: true } },
  assignee: { include: { user: { select: { displayName: true } } } },
} as const;

export type FollowUpTask = Prisma.RecordFollowUpGetPayload<{
  include: typeof followUpInclude;
}>;

export interface FollowUpMeta {
  requestId: string;
  ip?: string;
}

export interface FollowUpRecordScope {
  objectId: string;
  recordId: string;
  requiredOwnerMemberId?: string;
  expectedRole?: TenantContext['role'];
}

export function presentFollowUp(
  task: FollowUpTask,
  canManage = true,
  now = new Date(),
) {
  return {
    id: task.id,
    assigneeMemberId: task.assigneeMemberId,
    assigneeName:
      task.assignee.user.displayName ?? task.assignee.employeeNo ?? '成员',
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

/**
 * Re-checks the acting member under lock before a follow-up is written. The
 * error code is `OBJECT_ACTION_FORBIDDEN` (403) on this path — `update()`
 * deliberately uses `WORKSPACE_FORBIDDEN` instead.
 */
export async function lockFollowUpActor(
  tx: Prisma.TransactionClient,
  context: TenantContext,
): Promise<void> {
  const members = await tx.$queryRaw<
    Array<{ id: string; role: string }>
  >`SELECT id, role FROM tenant_members WHERE tenant_id=${context.tenantId}::uuid AND id=${context.memberId}::uuid AND status='ACTIVE' FOR UPDATE`;
  if (!members.length || members[0].role !== context.role)
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}

/**
 * Locks the target record (and re-checks visibility and the optional owner
 * requirement) for both the create and the update path.
 */
export async function lockFollowUpRecord(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  scope: FollowUpRecordScope,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM records WHERE tenant_id = ${context.tenantId}::uuid
        AND object_id = ${scope.objectId}::uuid AND id = ${scope.recordId}::uuid AND deleted_at IS NULL
        AND (${scope.requiredOwnerMemberId ?? null}::uuid IS NULL OR owner_member_id = ${scope.requiredOwnerMemberId ?? null}::uuid)
      FOR UPDATE
    `;
  if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
}

export function appendFollowUpAudit(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  context: TenantContext,
  id: string,
  action: string,
  meta: FollowUpMeta,
  after: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<void> {
  return audit.append(tx, {
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

export interface CreateFollowUpCommandInput {
  recordId: string;
  /** Already trimmed by the caller; this command adds no title policy. */
  title: string;
  /** Validated by the caller; the command maps it with `new Date()`. */
  dueAt: string;
}

export interface CreateFollowUpCommandDeps {
  audit: AuditService;
}

/**
 * Creates one follow-up for the ACTING member. The assignee is hard-coded to
 * `context.memberId` on purpose: an explicit or other assignee is a later
 * Action Engine concern and needs its own command input (§22).
 */
export async function createFollowUpCommand(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  input: CreateFollowUpCommandInput,
  meta: FollowUpMeta,
  scope: FollowUpRecordScope,
  deps: CreateFollowUpCommandDeps,
) {
  await lockFollowUpActor(tx, context);
  await lockFollowUpRecord(tx, context, scope);
  const item = await tx.recordFollowUp.create({
    data: {
      id: randomUUID(),
      tenantId: context.tenantId,
      assigneeMemberId: context.memberId,
      recordId: input.recordId,
      title: input.title,
      dueAt: new Date(input.dueAt),
    },
    include: followUpInclude,
  });
  await appendFollowUpAudit(
    tx,
    deps.audit,
    context,
    item.id,
    'follow_up.created',
    meta,
    {
      title: item.title,
      dueAt: item.dueAt.toISOString(),
      recordId: item.recordId,
    },
  );
  return presentFollowUp(item);
}
