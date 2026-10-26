import type { Prisma } from '@crm/database';

import type { CompanyPeriod } from './company-calendar';

export const WORK_COUNTERS = [
  'calls',
  'connectedCalls',
  'messages',
  'wechatAdded',
  'visits',
  'notes',
  'customersFollowed',
  'leadsClaimed',
  'contactsConfirmed',
  'recordsCreated',
  'followUpsDone',
  'followUpsOverdue',
  'followUpsOverdueInPeriod',
  'tasksDone',
  'tasksOverdue',
  'tasksOverdueInPeriod',
  'reportsWritten',
] as const;
export type WorkCounter = (typeof WORK_COUNTERS)[number];
export type WorkCounts = Record<WorkCounter, number>;

export const emptyCounts = (): WorkCounts =>
  Object.fromEntries(WORK_COUNTERS.map((key) => [key, 0])) as WorkCounts;

/**
 * What members did in a period, counted only from rows written when the work
 * happened. Nothing is estimated and nothing is read from daily reports, so a
 * call that is also mentioned in a report is still one call.
 *
 * - calls / messages / visits / notes: activities each member logged
 *   (电话 / 微信·消息 / 拜访 / 备注). connectedCalls: calls logged as 已接通.
 * - wechatAdded: customers whose WeChat a member explicitly logged as newly
 *   added. Each member–customer pair counts once, in the period of its first
 *   such entry; a later entry for the same pair is not a new contact.
 * - customersFollowed: distinct records on tables that use the customer pool
 *   with a call, message or visit by the member. Notes are not follow-up, and
 *   records of other tables are not customers.
 * - leadsClaimed / contactsConfirmed: 领取 and 确认联系 in the audit log;
 *   confirmations made by logging a contact outcome are the same audited
 *   action, so they count once.
 * - followUps* (customer follow-ups) and tasks* (general work tasks):
 *   completed in the period; overdue right now; and due in the period but not
 *   completed by their due time.
 * - reportsWritten: daily reports saved for work dates in the period.
 */
export async function countMemberWork(
  tx: Prisma.TransactionClient,
  tenantId: string,
  period: CompanyPeriod,
  memberIds?: string[],
): Promise<Map<string, WorkCounts>> {
  const { fromAt, toAt, fromDay, toDay } = period;
  const only = memberIds ?? null;
  type Row = { memberId: string; count: number };
  const [activities, goals, pool, created, followUps, tasks, reports] =
    await Promise.all([
      tx.$queryRaw<Array<Row & { type: string }>>`
      SELECT actor_member_id AS "memberId", activity_type::text AS type,
        count(*)::int AS count
      FROM record_activities
      WHERE tenant_id = ${tenantId}::uuid AND actor_member_id IS NOT NULL
        AND (${only}::uuid[] IS NULL OR actor_member_id = ANY(${only}::uuid[]))
        AND created_at >= ${fromAt} AND created_at < ${toAt}
        AND activity_type IN ('MESSAGE', 'MEETING', 'NOTE')
      GROUP BY 1, 2`,
      tx.$queryRaw<
        Array<{ member_id: string; metric: WorkCounter; actual: number }>
      >`
      SELECT * FROM count_member_goal_work(${tenantId}::uuid, ${fromAt}, ${toAt}, ${only}::uuid[])`,
      tx.$queryRaw<Array<Row & { action: string }>>`
      SELECT m.id AS "memberId", a.action, count(*)::int AS count
      FROM audit_logs a
      JOIN tenant_members m ON m.tenant_id = a.tenant_id AND m.user_id = a.actor_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.actor_type = 'USER'
        AND (${only}::uuid[] IS NULL OR m.id = ANY(${only}::uuid[]))
        AND a.action IN ('record.ownership_confirm_contact', 'record.ownership_claim')
        AND a.created_at >= ${fromAt} AND a.created_at < ${toAt}
      GROUP BY 1, 2`,
      tx.$queryRaw<Row[]>`
      SELECT created_by_member_id AS "memberId", count(*)::int AS count
      FROM records
      WHERE tenant_id = ${tenantId}::uuid AND created_by_member_id IS NOT NULL
        AND (${only}::uuid[] IS NULL OR created_by_member_id = ANY(${only}::uuid[]))
        AND deleted_at IS NULL AND created_at >= ${fromAt} AND created_at < ${toAt}
      GROUP BY 1`,
      taskCounts(tx, 'record_follow_ups', tenantId, only, fromAt, toAt),
      taskCounts(tx, 'work_tasks', tenantId, only, fromAt, toAt),
      tx.$queryRaw<Row[]>`
      SELECT member_id AS "memberId", count(*)::int AS count
      FROM daily_reports
      WHERE tenant_id = ${tenantId}::uuid
        AND (${only}::uuid[] IS NULL OR member_id = ANY(${only}::uuid[]))
        AND work_date BETWEEN ${fromDay}::date AND ${toDay}::date
      GROUP BY 1`,
    ]);

  const result = new Map<string, WorkCounts>();
  const add = (memberId: string, key: WorkCounter, count: number) => {
    const row = result.get(memberId) ?? emptyCounts();
    row[key] += count;
    result.set(memberId, row);
  };
  const byType: Record<string, WorkCounter> = {
    MESSAGE: 'messages',
    MEETING: 'visits',
    NOTE: 'notes',
  };
  for (const row of activities) {
    add(row.memberId, byType[row.type], row.count);
  }
  for (const row of goals) add(row.member_id, row.metric, row.actual);
  for (const row of pool)
    add(
      row.memberId,
      row.action === 'record.ownership_claim'
        ? 'leadsClaimed'
        : 'contactsConfirmed',
      row.count,
    );
  for (const row of created) add(row.memberId, 'recordsCreated', row.count);
  for (const row of followUps) {
    add(row.memberId, 'followUpsOverdue', row.overdue);
    add(row.memberId, 'followUpsOverdueInPeriod', row.overdueInPeriod);
  }
  for (const row of tasks) {
    add(row.memberId, 'tasksOverdue', row.overdue);
    add(row.memberId, 'tasksOverdueInPeriod', row.overdueInPeriod);
  }
  for (const row of reports) add(row.memberId, 'reportsWritten', row.count);
  return result;
}

/**
 * The same three task measures for customer follow-ups and general tasks.
 * Follow-ups on deleted records are left out, as everywhere else.
 */
function taskCounts(
  tx: Prisma.TransactionClient,
  table: 'record_follow_ups' | 'work_tasks',
  tenantId: string,
  only: string[] | null,
  fromAt: Date,
  toAt: Date,
) {
  type Row = {
    memberId: string;
    overdue: number;
    overdueInPeriod: number;
  };
  const measures = (alias: string) => `
    count(*) FILTER (WHERE ${alias}.status = 'OPEN' AND ${alias}.due_at < now())::int AS overdue,
    count(*) FILTER (WHERE ${alias}.due_at >= $2 AND ${alias}.due_at < $3 AND ${alias}.due_at < now()
      AND ${alias}.status <> 'CANCELLED'
      AND (${alias}.completed_at IS NULL OR ${alias}.completed_at > ${alias}.due_at))::int AS "overdueInPeriod"`;
  const sql =
    table === 'record_follow_ups'
      ? `SELECT f.assignee_member_id AS "memberId", ${measures('f')}
         FROM record_follow_ups f JOIN records r ON r.tenant_id = f.tenant_id AND r.id = f.record_id
         WHERE f.tenant_id = $1::uuid AND r.deleted_at IS NULL
           AND ($4::uuid[] IS NULL OR f.assignee_member_id = ANY($4::uuid[]))
         GROUP BY 1`
      : `SELECT t.assignee_member_id AS "memberId", ${measures('t')}
         FROM work_tasks t
         WHERE t.tenant_id = $1::uuid
           AND ($4::uuid[] IS NULL OR t.assignee_member_id = ANY($4::uuid[]))
         GROUP BY 1`;
  return tx.$queryRawUnsafe<Row[]>(sql, tenantId, fromAt, toAt, only);
}
