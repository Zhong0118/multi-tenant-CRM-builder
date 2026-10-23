import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { resolveCompanyPeriod, type CompanyPeriod } from './company-calendar';
import { lockWorkMembers } from './work-locks';
import { countMemberWork, emptyCounts } from './work-metrics';
import type { WorkMeta } from './work-tasks.service';

const SECTIONS = ['plans', 'completed', 'problems', 'nextSteps'] as const;
type Sections = Record<(typeof SECTIONS)[number], string>;

/**
 * 工作日报: one short report per member and company work date — plans, what
 * got done, problems and next steps. No approval step. A member writes and
 * edits their own reports; administrators read everyone's. Beside the text
 * the report shows, read-only, the tasks and activity counts recorded for
 * that day, so nobody re-types them and they are never counted twice.
 */
@Injectable()
export class DailyReportsService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  /** A member's report for a day, or an empty draft, with that day's reference. */
  get(context: TenantContext, workDate: string, memberId = context.memberId) {
    if (memberId !== context.memberId && context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner.withTenant(context, async (tx) => {
      const day = await workDay(tx, context.tenantId, workDate);
      const member = await tx.tenantMember.findFirst({
        where: { tenantId: context.tenantId, id: memberId },
        include: { user: { select: { displayName: true } } },
      });
      if (!member) throw new ApiException('RECORD_NOT_FOUND', 404);
      const report = await tx.dailyReport.findUnique({
        where: {
          tenantId_memberId_workDate: {
            tenantId: context.tenantId,
            memberId,
            workDate: new Date(`${day.fromDay}T00:00:00Z`),
          },
        },
      });
      return {
        workDate: day.fromDay,
        today: day.today,
        memberId,
        memberName: member.displayName ?? member.user.displayName ?? '成员',
        canEdit: memberId === context.memberId,
        report: report ? presentReport(report) : null,
        reference: await reference(tx, context.tenantId, memberId, day),
      };
    });
  }

  /** Who wrote a report for a work date; administrators only. */
  listForDate(context: TenantContext, workDate: string) {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner.withTenant(context, async (tx) => {
      const day = await workDay(tx, context.tenantId, workDate);
      const [members, reports] = await Promise.all([
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId, status: 'ACTIVE' },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.dailyReport.findMany({
          where: {
            tenantId: context.tenantId,
            workDate: new Date(`${day.fromDay}T00:00:00Z`),
          },
        }),
      ]);
      const byMember = new Map(
        reports.map((report) => [report.memberId, report]),
      );
      return {
        workDate: day.fromDay,
        items: members.map((member) => {
          const report = byMember.get(member.id);
          return {
            memberId: member.id,
            memberName: member.displayName ?? member.user.displayName ?? '成员',
            report: report ? presentReport(report) : null,
          };
        }),
      };
    });
  }

  /** Saves the actor's own report; `version` 0 creates it. */
  save(
    context: TenantContext,
    workDate: string,
    input: Sections & { version: number },
    meta: WorkMeta,
  ) {
    const sections = validated(input);
    return this.runner.withTenant(context, async (tx) => {
      await lockWorkMembers(tx, context);
      const day = await workDay(tx, context.tenantId, workDate);
      const key = {
        tenantId: context.tenantId,
        memberId: context.memberId,
        workDate: new Date(`${day.fromDay}T00:00:00Z`),
      };
      let saved;
      if (input.version === 0) {
        // The unique key makes a concurrent first save fail rather than
        // produce two reports; the loser reloads and edits the winner's.
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO daily_reports (tenant_id, member_id, work_date, plans, completed, problems, next_steps)
          VALUES (${key.tenantId}::uuid, ${key.memberId}::uuid, ${day.fromDay}::date,
            ${sections.plans}, ${sections.completed}, ${sections.problems}, ${sections.nextSteps})
          ON CONFLICT (tenant_id, member_id, work_date) DO NOTHING
          RETURNING id`;
        if (!inserted.length)
          throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
            message: '这一天的日报已经保存过，请刷新后再编辑。',
          });
        saved = await tx.dailyReport.findUniqueOrThrow({
          where: { id: inserted[0].id },
        });
      } else {
        const updated = await tx.dailyReport.updateMany({
          where: { ...key, version: input.version },
          data: {
            ...sections,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1)
          throw new ApiException('RECORD_VERSION_CONFLICT', 409);
        saved = await tx.dailyReport.findUniqueOrThrow({
          where: { tenantId_memberId_workDate: key },
        });
      }
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action:
          input.version === 0 ? 'daily_report.created' : 'daily_report.updated',
        resourceType: 'daily_report',
        resourceId: saved.id,
        after: { workDate: day.fromDay, version: saved.version },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return presentReport(saved);
    });
  }
}

/**
 * A single company day that is not in the future. `today` is resolved in the
 * company's timezone, so a browser in another timezone opens the right day.
 */
async function workDay(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workDate: string,
): Promise<CompanyPeriod> {
  if (workDate === 'today')
    return resolveCompanyPeriod(tx, tenantId, { preset: 'today' });
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(workDate) ||
    workDate.startsWith('0000-') ||
    !Number.isFinite(Date.parse(workDate)) ||
    new Date(workDate).toISOString().slice(0, 10) !== workDate
  )
    throw dateInvalid('请选择有效的日期。');
  const day = await resolveCompanyPeriod(tx, tenantId, {
    from: workDate,
    to: workDate,
  });
  if (day.fromDay > day.today)
    throw dateInvalid('不能提前填写未来日期的日报。');
  return day;
}

function dateInvalid(message: string) {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { workDate: [message] },
  });
}

async function reference(
  tx: Prisma.TransactionClient,
  tenantId: string,
  memberId: string,
  day: CompanyPeriod,
) {
  const [counts, tasks] = await Promise.all([
    countMemberWork(tx, tenantId, day, [memberId]),
    tx.workTask.findMany({
      where: {
        tenantId,
        assigneeMemberId: memberId,
        OR: [
          { completedAt: { gte: day.fromAt, lt: day.toAt } },
          { status: 'OPEN', dueAt: { lt: day.toAt } },
        ],
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 50,
    }),
  ]);
  return {
    counts: counts.get(memberId) ?? emptyCounts(),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
      result: task.result,
    })),
  };
}

function validated(input: Partial<Sections>): Sections {
  const sections = Object.fromEntries(
    SECTIONS.map((key) => [key, (input[key] ?? '').trim()]),
  ) as Sections;
  const errors: Record<string, string[]> = {};
  for (const key of SECTIONS)
    if (sections[key].length > 4000) errors[key] = ['不能超过 4000 字。'];
  if (SECTIONS.every((key) => sections[key] === ''))
    errors.completed = ['请至少填写一项内容。'];
  if (Object.keys(errors).length)
    throw new ApiException('VALIDATION_FAILED', 400, { fieldErrors: errors });
  return sections;
}

function presentReport(report: {
  id: string;
  workDate: Date;
  plans: string;
  completed: string;
  problems: string;
  nextSteps: string;
  version: number;
  updatedAt: Date;
}) {
  return {
    id: report.id,
    workDate: report.workDate.toISOString().slice(0, 10),
    plans: report.plans,
    completed: report.completed,
    problems: report.problems,
    nextSteps: report.nextSteps,
    version: report.version,
    updatedAt: report.updatedAt.toISOString(),
  };
}
