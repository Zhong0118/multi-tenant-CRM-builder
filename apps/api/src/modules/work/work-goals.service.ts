import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { resolveCompanyPeriod } from './company-calendar';
import {
  GOAL_METRICS,
  type GoalMetric,
  type SaveWorkGoalDto,
  type WorkGoalDto,
  type WorkGoalProgressItemDto,
} from './dto/work-goals.dto';
import { lockWorkMembers } from './work-locks';
import type { WorkMeta } from './work-tasks.service';
const include = { recipients: { select: { memberId: true } } } as const;
type Rule = Prisma.WorkGoalRuleGetPayload<{ include: typeof include }>;
const activeEmployees = {
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  user: { status: 'ACTIVE' },
} as const;
@Injectable()
export class WorkGoalsService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}
  settings(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, async (tx) => {
      const [period, rules, members] = await Promise.all([
        resolveCompanyPeriod(tx, context.tenantId, {}),
        tx.workGoalRule.findMany({
          where: { tenantId: context.tenantId },
          include,
          orderBy: { metric: 'asc' },
        }),
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId, ...activeEmployees },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      return {
        timezone: period.timezone,
        rules: rules.map(present),
        members: members.map((m) => ({
          id: m.id,
          name: m.displayName ?? m.user.displayName ?? '成员',
        })),
      };
    });
  }
  save(
    context: TenantContext,
    metric: string,
    input: SaveWorkGoalDto,
    meta: WorkMeta,
  ) {
    admin(context);
    if (!GOAL_METRICS.includes(metric as GoalMetric))
      throw new ApiException('VALIDATION_FAILED', 400);
    if (input.audience === 'SELECTED_MEMBERS' && input.memberIds.length === 0)
      throw invalidMembers();
    // ALL_EMPLOYEES is dynamic; stale selected ids must never imply exclusions.
    const ids = input.audience === 'SELECTED_MEMBERS' ? input.memberIds : [];
    return this.runner.withTenant(context, async (tx) => {
      await lockWorkMembers(tx, context, ids);
      if (
        ids.length !==
        (await tx.tenantMember.count({
          where: {
            tenantId: context.tenantId,
            id: { in: ids },
            ...activeEmployees,
          },
        }))
      )
        throw invalidMembers();
      // Actor locks serialize this administrator; a tenant/metric advisory lock
      // also serializes first creation by different administrators.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId + ':goal:' + metric},0))::text`;
      await tx.$queryRaw`SELECT id FROM work_goal_rules WHERE tenant_id=${context.tenantId}::uuid AND metric=${metric} FOR UPDATE`;
      const before = await tx.workGoalRule.findUnique({
        where: { tenantId_metric: { tenantId: context.tenantId, metric } },
        include,
      });
      if ((before?.version ?? 0) !== input.expectedVersion)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      const data = {
        target: input.target,
        remindAt: input.remindAt,
        weekdays: input.weekdays,
        audience: input.audience,
        enabled: input.enabled,
      };
      const rule = before
        ? await tx.workGoalRule.update({
            where: { id: before.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.workGoalRule.create({
            data: { tenantId: context.tenantId, metric, ...data },
          });
      await tx.workGoalRecipient.deleteMany({
        where: { tenantId: context.tenantId, ruleId: rule.id },
      });
      if (ids.length)
        await tx.workGoalRecipient.createMany({
          data: ids.map((memberId) => ({
            tenantId: context.tenantId,
            ruleId: rule.id,
            memberId,
          })),
        });
      const after = present({
        ...rule,
        recipients: ids.map((memberId) => ({ memberId })),
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'work_goal.saved',
        resourceType: 'work_goal',
        resourceId: rule.id,
        before: before ? { ...present(before) } : undefined,
        after: { ...after },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return after;
    });
  }
  progress(context: TenantContext, query: { scope?: 'mine' | 'team' }) {
    if (query.scope === 'team') admin(context);
    return this.runner.withTenant(context, async (tx) => {
      const period = await resolveCompanyPeriod(tx, context.tenantId, {});
      const [rules, members] = await Promise.all([
        tx.workGoalRule.findMany({
          where: { tenantId: context.tenantId, enabled: true },
          include,
          orderBy: { metric: 'asc' },
        }),
        tx.tenantMember.findMany({
          where: {
            tenantId: context.tenantId,
            ...activeEmployees,
            ...(query.scope === 'team' ? {} : { id: context.memberId }),
          },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const ids = members.map((m) => m.id);
      const counts = ids.length
        ? await tx.$queryRaw<
            Array<{ member_id: string; metric: GoalMetric; actual: number }>
          >`SELECT * FROM count_member_goal_work(${context.tenantId}::uuid,${period.fromAt},${period.toAt},${ids}::uuid[])`
        : [];
      const actual = new Map(
        counts.map((c) => [c.member_id + ':' + c.metric, c.actual]),
      );
      const [calendar] = await tx.$queryRaw<
        Array<{ weekday: number }>
      >`SELECT extract(isodow FROM ${period.today}::date)::int AS weekday`;
      const items: WorkGoalProgressItemDto[] = [];
      for (const rule of rules)
        for (const member of members) {
          if (
            rule.audience === 'SELECTED_MEMBERS' &&
            !rule.recipients.some((r) => r.memberId === member.id)
          )
            continue;
          items.push({
            ruleId: rule.id,
            metric: rule.metric as GoalMetric,
            memberId: member.id,
            memberName: member.displayName ?? member.user.displayName ?? '成员',
            target: rule.target,
            actual: actual.get(member.id + ':' + rule.metric) ?? 0,
            remindAt: rule.remindAt,
            scheduledToday: rule.weekdays.includes(calendar.weekday),
          });
        }
      return { timezone: period.timezone, today: period.today, items };
    });
  }
}
function present(rule: Rule): WorkGoalDto {
  return {
    id: rule.id,
    metric: rule.metric as GoalMetric,
    target: rule.target,
    remindAt: rule.remindAt,
    weekdays: rule.weekdays,
    audience: rule.audience as WorkGoalDto['audience'],
    memberIds: rule.recipients.map((r) => r.memberId).sort(),
    enabled: rule.enabled,
    version: rule.version,
  };
}
function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
function invalidMembers() {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { memberIds: ['请选择本公司的在职员工。'] },
  });
}
