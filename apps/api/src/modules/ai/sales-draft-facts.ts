import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { requireVisibleRecord } from '../records/record-command';
import type { RecordsTransaction } from '../records/records.repository';
import { MEMBER_ACTIVITY_TYPES } from '../records/record-activity';
import {
  localDateAt,
  isValidFollowUpTimeZone,
} from '../follow-ups/follow-up-workbench-time';
import { readTarget, visible } from './assistant-question-data';
import {
  reportRange,
  writingFields,
  type SalesFact,
} from './sales-draft-output';

async function timezone(db: RecordsTransaction) {
  const zone = (await db.store.getTenantTimezone?.()) ?? null;
  if (!isValidFollowUpTimeZone(zone))
    throw new ApiException('INTERNAL_ERROR', 500);
  return zone;
}

function boundedFacts(rows: Omit<SalesFact, 'id'>[]) {
  let chars = 0;
  const facts: SalesFact[] = [];
  for (const row of rows) {
    if (chars + row.text.length > 12000) break;
    facts.push({ ...row, id: 'F' + (facts.length + 1) });
    chars += row.text.length;
  }
  return { facts, truncated: facts.length < rows.length };
}

export async function writingFacts(
  db: RecordsTransaction,
  actor: TenantContext,
  objectCode: string,
  recordId: string,
  supplement?: string,
) {
  const current = await readTarget(db, actor, { objectCode, recordId });
  if (current.record.inPublicPool && actor.role !== 'TENANT_ADMIN')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const zone = await timezone(db);
  const values = writingFields(current, 100, zone);
  const rows = [
    current.title.slice(0, 300),
    ...(supplement ? [supplement] : []),
    ...values,
  ];
  const { items, total } = await db.store.listActivities(recordId, {
    page: 1,
    limit: 10,
  });
  rows.push(
    ...items.map(
      (a) =>
        localDateAt(new Date(a.createdAt), zone) +
        ' 沟通：' +
        a.content.slice(0, 300),
    ),
  );
  const open = await db.tx.recordFollowUp.findMany({
    where: {
      tenantId: actor.tenantId,
      recordId,
      assigneeMemberId: actor.memberId,
      status: 'OPEN',
    },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    take: 21,
    select: { title: true, dueAt: true },
  });
  rows.push(
    ...open
      .slice(0, 20)
      .map((f) => '跟进：' + f.title + '；到期 ' + localDateAt(f.dueAt, zone)),
  );
  const relations = await db.tx.$queryRaw<
    { recordId: string; objectCode: string }[]
  >`
    SELECT r.id AS "recordId",o.code AS "objectCode" FROM record_relations l
    JOIN records r ON r.tenant_id=l.tenant_id AND r.id=CASE WHEN l.source_record_id=${recordId}::uuid THEN l.target_record_id ELSE l.source_record_id END
    JOIN object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id
    WHERE l.tenant_id=${actor.tenantId}::uuid AND (l.source_record_id=${recordId}::uuid OR l.target_record_id=${recordId}::uuid) AND r.deleted_at IS NULL
    ORDER BY l.created_at DESC,l.id LIMIT 21`;
  let count = 0;
  for (const ref of relations) {
    const target = await visible(() => readTarget(db, actor, ref));
    if (
      !target ||
      (target.record.inPublicPool && actor.role !== 'TENANT_ADMIN')
    )
      continue;
    rows.push(
      '关联：' +
        [target.title, ...writingFields(target, 3, zone)]
          .join('；')
          .slice(0, 500),
    );
    if (++count === 5) break;
  }
  const limited = boundedFacts(rows.map((text) => ({ text })));
  const canLog = Boolean(
    await visible(() =>
      requireVisibleRecord(
        db.store,
        current.resolved,
        actor,
        recordId,
        'UPDATE',
      ),
    ),
  );
  return {
    ...limited,
    canLog,
    title: current.title,
    timeZone: zone,
    truncated:
      limited.truncated ||
      total > 10 ||
      open.length > 20 ||
      relations.length > count ||
      values.length >= 100,
  };
}

export async function reportFacts(
  db: RecordsTransaction,
  actor: TenantContext,
  workDate: string,
) {
  const zone = await timezone(db);
  const { start, next, end } = reportRange(workDate, zone);
  const day = { gte: start, lt: next },
    tomorrow = { gte: next, lt: end };
  const { tenantId, memberId } = actor;
  const recordSelect = {
    select: { id: true, object: { select: { code: true } } },
  } as const;
  const [activities, follows, tasks, created, transitions] = await Promise.all([
    db.tx.recordActivity.findMany({
      where: {
        tenantId,
        actorMemberId: memberId,
        activityType: { in: [...MEMBER_ACTIVITY_TYPES] },
        createdAt: day,
        completedFollowUp: null,
      },
      select: {
        id: true,
        record: recordSelect,
        content: true,
        resultKey: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.tx.recordFollowUp.findMany({
      where: {
        tenantId,
        OR: [
          {
            status: 'DONE',
            completedAt: day,
            completionActivity: { actorMemberId: memberId },
          },
          { status: 'OPEN', assigneeMemberId: memberId, dueAt: tomorrow },
        ],
      },
      select: {
        id: true,
        record: recordSelect,
        title: true,
        status: true,
        completionActivity: { select: { content: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    // Only a task's latest completion identifies its actual performer. Admins
    // can complete a teammate's task and completed tasks can be reopened.
    db.tx.$queryRaw<{ status: string; title: string; result: string }[]>`
      SELECT t.status,
        CASE WHEN t.status='DONE' THEN coalesce(a.after->>'title',t.title) ELSE t.title END AS title,
        CASE WHEN t.version::text=a.after->>'version' THEN t.result ELSE '' END AS result
      FROM work_tasks t
      LEFT JOIN LATERAL (
        SELECT actor_id,after FROM audit_logs
        WHERE tenant_id=t.tenant_id AND resource_id=t.id AND resource_type='work_task'
          AND actor_type='USER' AND action='work_task.completed'
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) a ON t.status='DONE'
      WHERE t.tenant_id=${tenantId}::uuid AND (
        (t.status='OPEN' AND t.assignee_member_id=${memberId}::uuid AND t.due_at>=${next} AND t.due_at<${end})
        OR (t.status='DONE' AND a.actor_id=${actor.userId}::uuid AND t.completed_at>=${start} AND t.completed_at<${next}
          AND (${actor.role === 'TENANT_ADMIN'} OR t.assignee_member_id=${memberId}::uuid OR t.created_by_member_id=${memberId}::uuid))
      ) ORDER BY t.due_at,t.id`,
    db.tx.record.findMany({
      where: {
        tenantId,
        deletedAt: null,
        createdByMemberId: memberId,
        createdAt: day,
      },
      select: recordSelect.select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.tx.recordTransitionHistory.findMany({
      where: { tenantId, actorMemberId: memberId, createdAt: day },
      select: { id: true, record: recordSelect },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const rows: Omit<SalesFact, 'id'>[] = [];
  const titles = new Map<string, string | undefined>();
  async function title(record: { id: string; object: { code: string } }) {
    if (!titles.has(record.id)) {
      const target = await visible(() =>
        readTarget(db, actor, {
          objectCode: record.object.code,
          recordId: record.id,
        }),
      );
      titles.set(
        record.id,
        target && (!target.record.inPublicPool || actor.role === 'TENANT_ADMIN')
          ? target.title
          : undefined,
      );
    }
    return titles.get(record.id);
  }
  for (const a of activities) {
    const t = await title(a.record);
    if (!t) continue;
    rows.push({
      section: 'completed',
      text: t + '，沟通记录：' + a.content.slice(0, 400),
    });
    if (a.resultKey === 'NOT_REACHED')
      rows.push({ section: 'problems', text: t + '，此次联系未获回应。' });
    for (const line of a.content.split('\n')) {
      const explicit = /^(问题|计划)[：:]\s*(.+)$/u.exec(line.trim());
      if (explicit)
        rows.push({
          section: explicit[1] === '问题' ? 'problems' : 'plans',
          text: t + '：' + explicit[2].slice(0, 300),
        });
    }
  }
  for (const f of follows) {
    const t = await title(f.record);
    if (!t) continue;
    rows.push(
      f.status === 'OPEN'
        ? { section: 'nextSteps', text: '跟进' + t + '：' + f.title }
        : {
            section: 'completed',
            text:
              '完成' +
              t +
              '的跟进：' +
              f.title +
              (f.completionActivity?.content
                ? '。' + f.completionActivity.content.slice(0, 300)
                : ''),
          },
    );
  }
  for (const t of tasks) {
    if (t.status === 'OPEN')
      rows.push({ section: 'nextSteps', text: '处理任务：' + t.title });
    else
      rows.push({
        section: 'completed',
        text:
          '完成任务：' +
          t.title +
          (t.result ? '。' + t.result.slice(0, 300) : ''),
      });
  }
  for (const record of created) {
    const t = await title(record);
    if (t)
      rows.push({ section: 'completed', text: '创建了记录「' + t + '」。' });
  }
  for (const h of transitions) {
    const t = await title(h.record);
    if (t)
      rows.push({
        section: 'completed',
        text: '办理了「' + t + '」的状态流转。',
      });
  }
  return boundedFacts(rows);
}
