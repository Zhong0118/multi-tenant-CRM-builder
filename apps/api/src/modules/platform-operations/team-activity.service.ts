import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';

export interface TeamActivityQuery {
  /** Calendar days (`YYYY-MM-DD`), inclusive, in the company's timezone. Default: today. */
  from?: string;
  to?: string;
}

export interface MemberActivity {
  memberId: string;
  name: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  status: 'ACTIVE' | 'DISABLED';
  calls: number;
  messages: number;
  visits: number;
  notes: number;
  customersFollowed: number;
  contactsConfirmed: number;
  leadsClaimed: number;
  tasksDone: number;
  tasksOverdue: number;
  recordsCreated: number;
}

interface Bounds {
  timezone: string;
  fromAt: Date;
  toAt: Date;
  fromDay: string;
  toDay: string;
}

const COUNTERS = [
  'calls',
  'messages',
  'visits',
  'notes',
  'customersFollowed',
  'contactsConfirmed',
  'leadsClaimed',
  'tasksDone',
  'tasksOverdue',
  'recordsCreated',
] as const;

/**
 * What each member did in a period, counted only from rows the system already
 * writes when the work happens — nothing is estimated:
 *
 * - calls / messages / visits / notes: activities logged on records (电话,
 *   消息 incl. 微信, 拜访, 备注), by who logged them;
 * - customersFollowed: distinct records those activities were logged on;
 * - contactsConfirmed / leadsClaimed: the staged pool's 确认已联系 and 领取
 *   actions in the audit log;
 * - tasksDone: follow-up tasks completed in the period, by assignee;
 * - tasksOverdue: open tasks already past due right now;
 * - recordsCreated: records the member created, on any table.
 *
 * Company administrators only: it shows every member's work.
 */
@Injectable()
export class TeamActivityService {
  constructor(private readonly runner: DatabaseContextRunner) {}

  async summarize(context: TenantContext, query: TeamActivityQuery) {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    if (
      (query.from && query.to && query.from > query.to) ||
      rangeTooLong(query)
    )
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { from: ['请选择 1 至 366 天内的日期范围。'] },
      });

    return this.runner.withTenant(context, async (tx) => {
      // Day boundaries are the company's calendar days, resolved by Postgres
      // with the same tz database as the stored instants.
      const [bounds] = await tx.$queryRaw<Bounds[]>`
        WITH days AS (
          SELECT timezone,
            COALESCE(${query.from ?? null}::date, (now() AT TIME ZONE timezone)::date) AS from_day,
            COALESCE(${query.to ?? null}::date, ${query.from ?? null}::date, (now() AT TIME ZONE timezone)::date) AS to_day
          FROM tenants WHERE id = ${context.tenantId}::uuid
        )
        SELECT timezone,
          (from_day::timestamp AT TIME ZONE timezone) AS "fromAt",
          ((to_day + 1)::timestamp AT TIME ZONE timezone) AS "toAt",
          from_day::text AS "fromDay", to_day::text AS "toDay"
        FROM days`;
      if (!bounds) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      const { fromAt, toAt } = bounds;
      const tenantId = context.tenantId;

      const [members, activities, followed, actions, done, overdue, created] =
        await Promise.all([
          tx.tenantMember.findMany({
            where: { tenantId },
            select: {
              id: true,
              displayName: true,
              role: true,
              status: true,
              user: { select: { displayName: true } },
            },
            orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
          }),
          tx.$queryRaw<
            Array<{ memberId: string; type: string; count: number }>
          >`
            SELECT actor_member_id AS "memberId", activity_type::text AS type, count(*)::int AS count
            FROM record_activities
            WHERE tenant_id = ${tenantId}::uuid AND actor_member_id IS NOT NULL
              AND created_at >= ${fromAt} AND created_at < ${toAt}
              AND activity_type IN ('CALL', 'MESSAGE', 'MEETING', 'NOTE')
            GROUP BY 1, 2`,
          tx.$queryRaw<Array<{ memberId: string; count: number }>>`
            SELECT actor_member_id AS "memberId", count(DISTINCT record_id)::int AS count
            FROM record_activities
            WHERE tenant_id = ${tenantId}::uuid AND actor_member_id IS NOT NULL
              AND created_at >= ${fromAt} AND created_at < ${toAt}
              AND activity_type IN ('CALL', 'MESSAGE', 'MEETING', 'NOTE')
            GROUP BY 1`,
          tx.$queryRaw<
            Array<{ memberId: string; action: string; count: number }>
          >`
            SELECT m.id AS "memberId", a.action, count(*)::int AS count
            FROM audit_logs a
            JOIN tenant_members m ON m.tenant_id = a.tenant_id AND m.user_id = a.actor_id
            WHERE a.tenant_id = ${tenantId}::uuid AND a.actor_type = 'USER'
              AND a.action IN ('record.ownership_confirm_contact', 'record.ownership_claim')
              AND a.created_at >= ${fromAt} AND a.created_at < ${toAt}
            GROUP BY 1, 2`,
          tx.$queryRaw<Array<{ memberId: string; count: number }>>`
            SELECT assignee_member_id AS "memberId", count(*)::int AS count
            FROM record_follow_ups
            WHERE tenant_id = ${tenantId}::uuid AND status = 'DONE'
              AND completed_at >= ${fromAt} AND completed_at < ${toAt}
            GROUP BY 1`,
          tx.$queryRaw<Array<{ memberId: string; count: number }>>`
            SELECT f.assignee_member_id AS "memberId", count(*)::int AS count
            FROM record_follow_ups f JOIN records r ON r.tenant_id = f.tenant_id AND r.id = f.record_id
            WHERE f.tenant_id = ${tenantId}::uuid AND f.status = 'OPEN'
              AND f.due_at < now() AND r.deleted_at IS NULL
            GROUP BY 1`,
          tx.$queryRaw<Array<{ memberId: string; count: number }>>`
            SELECT created_by_member_id AS "memberId", count(*)::int AS count
            FROM records
            WHERE tenant_id = ${tenantId}::uuid AND created_by_member_id IS NOT NULL
              AND deleted_at IS NULL AND created_at >= ${fromAt} AND created_at < ${toAt}
            GROUP BY 1`,
        ]);

      const rows = new Map<string, MemberActivity>(
        members.map((member) => [
          member.id,
          {
            memberId: member.id,
            // The company name for the member, else the account name, as on 成员.
            name: member.displayName ?? member.user.displayName ?? '未设置姓名',
            role: member.role,
            status: member.status,
            ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
          } as MemberActivity,
        ]),
      );
      const add = (
        memberId: string,
        key: (typeof COUNTERS)[number],
        count: number,
      ) => {
        const row = rows.get(memberId);
        if (row) row[key] += count;
      };
      const activityKey: Record<string, (typeof COUNTERS)[number]> = {
        CALL: 'calls',
        MESSAGE: 'messages',
        MEETING: 'visits',
        NOTE: 'notes',
      };
      for (const row of activities)
        add(row.memberId, activityKey[row.type], row.count);
      for (const row of followed)
        add(row.memberId, 'customersFollowed', row.count);
      for (const row of actions)
        add(
          row.memberId,
          row.action === 'record.ownership_claim'
            ? 'leadsClaimed'
            : 'contactsConfirmed',
          row.count,
        );
      for (const row of done) add(row.memberId, 'tasksDone', row.count);
      for (const row of overdue) add(row.memberId, 'tasksOverdue', row.count);
      for (const row of created) add(row.memberId, 'recordsCreated', row.count);

      const items = [...rows.values()].filter(
        (row) =>
          row.status === 'ACTIVE' || COUNTERS.some((key) => row[key] > 0),
      );
      const totals = Object.fromEntries(
        COUNTERS.map((key) => [
          key,
          items.reduce((sum, row) => sum + row[key], 0),
        ]),
      ) as Record<(typeof COUNTERS)[number], number>;
      return {
        timezone: bounds.timezone,
        from: bounds.fromDay,
        to: bounds.toDay,
        members: items,
        totals,
      };
    });
  }
}

function rangeTooLong(query: TeamActivityQuery): boolean {
  if (!query.from || !query.to) return false;
  const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
  return !Number.isFinite(days) || days > 366;
}
