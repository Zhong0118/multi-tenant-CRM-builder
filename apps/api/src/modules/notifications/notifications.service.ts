import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { isReadable } from '../objects/published-object.service';
import { RecordsService } from '../records/records.service';
import type {
  NotificationItemDto,
  NotificationKind,
  NotificationPageDto,
  NotificationsQueryDto,
} from './notifications.dto';

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  object_id: string | null;
  object_code: string | null;
  object_name: string | null;
  record_id: string | null;
  record_no: number | null;
  follow_up_id: string | null;
  created_at: Date;
  due_at: Date | null;
  read_at: Date | null;
  can_open: boolean;
  details: {
    date: string;
    metric: string;
    actual: number;
    target: number;
  } | null;
};
const READABLE = `(n.object_id=ANY($3::uuid[]) OR (n.object_id=ANY($4::uuid[]) AND (n.record_owner_member_id=$2::uuid OR EXISTS (SELECT 1 FROM records pr JOIN object_definitions po ON po.id=pr.object_id AND po.tenant_id=pr.tenant_id WHERE pr.tenant_id=n.tenant_id AND pr.id=n.record_id AND pr.in_public_pool AND po.pool_enabled))))`;
const VISIBLE = `n.tenant_id=$1::uuid AND n.recipient_member_id=$2::uuid AND (n.kind IN ('POOL_RECLAIMED','WORK_GOAL_BEHIND') OR ${READABLE})`;
const CAN_OPEN = `(n.kind='WORK_GOAL_BEHIND' OR (${READABLE} AND EXISTS (SELECT 1 FROM records r WHERE r.tenant_id=n.tenant_id AND r.id=n.record_id AND r.deleted_at IS NULL)))`;
const GOAL_NAMES: Record<string, string> = {
  calls: '电话次数',
  connectedCalls: '接通次数',
  wechatAdded: '新加微信',
  customersFollowed: '跟进客户',
  followUpsDone: '完成跟进',
  tasksDone: '完成任务',
};
const COPY: Record<NotificationKind, [string, string]> = {
  WORK_GOAL_BEHIND: ['每日目标尚未完成', '请查看今日工作进度'],
  CONTACT_DUE: [
    '联系期限即将到期',
    '请在期限内确认已联系，超时后记录会自动回到公海',
  ],
  FOLLOW_UP_DUE: [
    '跟进期限即将到期',
    '请及时补充跟进记录，超时后记录会自动回到公海',
  ],
  TASK_OVERDUE: ['跟进任务已逾期', '请查看跟进任务，完成或调整下一步安排'],
  POOL_RECLAIMED: [
    '记录已自动回到公海',
    '你曾负责的一条记录已到期，并被系统自动回收',
  ],
  PROTECTION_REVIEW: [
    '成交保护需要复核',
    '成交依据已发生变化，请检查这条记录的保护状态',
  ],
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly records: RecordsService,
  ) {}

  async list(
    context: TenantContext,
    query: NotificationsQueryDto,
  ): Promise<NotificationPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.runner.withTenant(context, async (tx) => {
      const params = await this.scopeParams(tx, context);
      const [counts] = await tx.$queryRawUnsafe<
        Array<{
          total: bigint;
          unread: bigint;
          server_time: Date;
          snapshot: string;
        }>
      >(
        `SELECT count(*) FILTER (WHERE NOT $5::boolean OR n.read_at IS NULL) AS total,
          count(*) FILTER (WHERE n.read_at IS NULL) AS unread, current_timestamp AS server_time, pg_current_snapshot()::text AS snapshot
         FROM current_member_notifications n WHERE ${VISIBLE}`,
        ...params,
        query.unreadOnly ?? false,
      );
      const rows = await tx.$queryRawUnsafe<NotificationRow[]>(
        `SELECT n.*, ${CAN_OPEN} AS can_open FROM current_member_notifications n
         WHERE ${VISIBLE} AND (NOT $5::boolean OR n.read_at IS NULL)
         ORDER BY n.created_at DESC,n.id DESC LIMIT $6 OFFSET $7`,
        ...params,
        query.unreadOnly ?? false,
        limit,
        (page - 1) * limit,
      );
      return {
        items: rows.map(toItem),
        total: Number(counts.total),
        unreadCount: Number(counts.unread),
        page,
        limit,
        serverTime: counts.server_time.toISOString(),
        snapshot: counts.snapshot,
      };
    });
  }

  async read(context: TenantContext, id: string): Promise<{ ok: true }> {
    await this.runner.withTenant(context, async (tx) => {
      const params = await this.scopeParams(tx, context);
      const changed = await tx.$executeRawUnsafe(
        `UPDATE member_notifications SET read_at=COALESCE(read_at,current_timestamp)
         WHERE id IN (SELECT n.id FROM current_member_notifications n WHERE ${VISIBLE} AND n.id=$5::uuid)`,
        ...params,
        id,
      );
      if (!changed) throw new ApiException('NOTIFICATION_NOT_FOUND', 404);
    });
    return { ok: true };
  }

  async readAll(
    context: TenantContext,
    before: string,
    snapshot: string,
  ): Promise<{ ok: true }> {
    await this.runner.withTenant(context, async (tx) => {
      const params = await this.scopeParams(tx, context);
      await tx.$executeRawUnsafe(
        `UPDATE member_notifications SET read_at=current_timestamp
         WHERE read_at IS NULL AND id IN (SELECT n.id FROM current_member_notifications n
         WHERE ${VISIBLE} AND n.created_at<=LEAST($5::timestamptz,current_timestamp) AND pg_visible_in_snapshot(n.created_xid::xid8,$6::pg_snapshot))`,
        ...params,
        before,
        snapshot,
      );
    });
    return { ok: true };
  }

  async target(
    context: TenantContext,
    id: string,
  ): Promise<{ href: string | null }> {
    const row = await this.runner.withTenant(context, async (tx) => {
      const owned = await tx.memberNotification.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          recipientMemberId: context.memberId,
        },
        select: { id: true },
      });
      if (!owned) throw new ApiException('NOTIFICATION_NOT_FOUND', 404);
      const params = await this.scopeParams(tx, context);
      const rows = await tx.$queryRawUnsafe<NotificationRow[]>(
        `SELECT n.*, ${CAN_OPEN} AS can_open FROM current_member_notifications n WHERE ${VISIBLE} AND n.id=$5::uuid`,
        ...params,
        id,
      );
      return rows[0];
    });
    if (!row?.can_open) return { href: null };
    if (row.kind === 'WORK_GOAL_BEHIND')
      return {
        href: `/workspace/${encodeURIComponent(context.tenantCode)}/work`,
      };
    if (!row.object_code || !row.record_id) return { href: null };
    try {
      // Reuse the record endpoint's current visibility check; notification delivery grants no access.
      await this.records.detail(context, row.object_code, row.record_id);
    } catch (error) {
      if (
        error instanceof ApiException &&
        [403, 404].includes(error.getStatus())
      )
        return { href: null };
      throw error;
    }
    const path = `/workspace/${encodeURIComponent(context.tenantCode)}/objects/${encodeURIComponent(row.object_code)}/${encodeURIComponent(row.record_id)}`;
    return {
      href: row.follow_up_id
        ? `${path}?followUp=${encodeURIComponent(row.follow_up_id)}`
        : path,
    };
  }

  private async scopeParams(
    tx: Prisma.TransactionClient,
    context: TenantContext,
  ) {
    // Resolve only tables represented in this member's current inbox, before SQL counts/pagination.
    const objects = await tx.$queryRawUnsafe<
      Array<{ object_id: string; object_code: string }>
    >(
      `SELECT DISTINCT n.object_id,n.object_code FROM current_member_notifications n
       JOIN object_definitions o ON o.id=n.object_id AND o.tenant_id=n.tenant_id
       WHERE n.tenant_id=$1::uuid AND n.recipient_member_id=$2::uuid AND o.status='ACTIVE' AND o.deleted_at IS NULL`,
      context.tenantId,
      context.memberId,
    );
    const all: string[] = [];
    const own: string[] = [];
    for (const object of objects) {
      try {
        const resolved = await resolvePublishedObjectInTransaction(
          tx,
          context,
          object.object_code,
        );
        if (!isReadable(resolved.schema, resolved.access)) continue;
        (resolved.access.readScope === 'ALL' ? all : own).push(
          object.object_id,
        );
      } catch (error) {
        if (!(
          error instanceof ApiException &&
          [403, 404].includes(error.getStatus())
        ))
          throw error;
      }
    }
    return [context.tenantId, context.memberId, all, own] as const;
  }
}
function toItem(row: NotificationRow): NotificationItemDto {
  const [title, copy] = COPY[row.kind];
  const message =
    row.kind === 'WORK_GOAL_BEHIND' && row.details
      ? `${row.details.date} · ${GOAL_NAMES[row.details.metric] ?? row.details.metric}：截至提醒时已完成 ${row.details.actual}，每日目标 ${row.details.target}`
      : row.can_open && row.kind !== 'POOL_RECLAIMED'
        ? `${row.object_name} · 记录 #${row.record_no}：${copy}`
        : copy;
  return {
    id: row.id,
    kind: row.kind,
    title,
    message,
    createdAt: row.created_at.toISOString(),
    dueAt: row.due_at?.toISOString() ?? null,
    readAt: row.read_at?.toISOString() ?? null,
    canOpen: row.can_open,
  };
}
