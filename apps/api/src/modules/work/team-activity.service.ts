import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { resolveCompanyPeriod, type PeriodPreset } from './company-calendar';
import {
  WORK_COUNTERS,
  countMemberWork,
  emptyCounts,
  type WorkCounts,
} from './work-metrics';

export interface TeamActivityQuery {
  /** Resolved in the company's calendar; wins over `from`/`to`. */
  preset?: PeriodPreset;
  /** Calendar days (`YYYY-MM-DD`), inclusive, in the company's timezone. */
  from?: string;
  to?: string;
}

export type MemberActivity = WorkCounts & {
  memberId: string;
  name: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  status: 'ACTIVE' | 'DISABLED';
};

/**
 * 团队动态: what each member did in a period of company calendar days, from
 * {@link countMemberWork}. Company administrators only: it shows every
 * member's work. Disabled members appear only when they did something in the
 * period.
 */
@Injectable()
export class TeamActivityService {
  constructor(private readonly runner: DatabaseContextRunner) {}

  summarize(context: TenantContext, query: TeamActivityQuery) {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    if (query.from && query.to && query.from > query.to)
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { from: ['请选择 1 至 366 天内的日期范围。'] },
      });

    return this.runner.withTenant(context, async (tx) => {
      const period = await resolveCompanyPeriod(tx, context.tenantId, query);
      const [members, counts] = await Promise.all([
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId },
          select: {
            id: true,
            displayName: true,
            role: true,
            status: true,
            user: { select: { displayName: true } },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        }),
        countMemberWork(tx, context.tenantId, period),
      ]);
      const items: MemberActivity[] = members
        .map((member) => ({
          memberId: member.id,
          // The company name for the member, else the account name, as on 成员.
          name: member.displayName ?? member.user.displayName ?? '未设置姓名',
          role: member.role,
          status: member.status,
          ...(counts.get(member.id) ?? emptyCounts()),
        }))
        .filter(
          (row) =>
            row.status === 'ACTIVE' ||
            WORK_COUNTERS.some((key) => row[key] > 0),
        );
      const totals = emptyCounts();
      for (const row of items)
        for (const key of WORK_COUNTERS) totals[key] += row[key];
      return {
        timezone: period.timezone,
        today: period.today,
        from: period.fromDay,
        to: period.toDay,
        members: items,
        totals,
      };
    });
  }
}
