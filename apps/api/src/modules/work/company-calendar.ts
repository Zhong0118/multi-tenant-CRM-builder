import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';

export const PERIOD_PRESETS = ['today', 'yesterday', 'week', 'month'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface CompanyPeriod {
  timezone: string;
  /** Today in the company's calendar. */
  today: string;
  fromDay: string;
  toDay: string;
  /** Inclusive start instant of `fromDay`, exclusive end instant of `toDay`. */
  fromAt: Date;
  toAt: Date;
}

/**
 * Resolves a period of whole company calendar days. Postgres applies the
 * company's timezone (the same tz database as stored instants), so "today",
 * "this week" and every boundary agree whatever timezone the browser or the
 * API host runs in. A preset wins over explicit days; with neither, the
 * period is today. Weeks start on Monday.
 */
export async function resolveCompanyPeriod(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preset?: PeriodPreset; from?: string; to?: string },
): Promise<CompanyPeriod> {
  if (input.from && input.to && input.from > input.to) throw periodInvalid();
  const [period] = await tx.$queryRaw<Array<CompanyPeriod & { days: number }>>`
    WITH company AS (
      SELECT timezone, (now() AT TIME ZONE timezone)::date AS today
      FROM tenants WHERE id = ${tenantId}::uuid
    ), days AS (
      SELECT timezone, today,
        CASE ${input.preset ?? null}::text
          WHEN 'today' THEN today
          WHEN 'yesterday' THEN today - 1
          WHEN 'week' THEN date_trunc('week', today)::date
          WHEN 'month' THEN date_trunc('month', today)::date
          ELSE COALESCE(${input.from ?? null}::date, today)
        END AS from_day,
        CASE ${input.preset ?? null}::text
          WHEN 'yesterday' THEN today - 1
          WHEN 'today' THEN today
          WHEN 'week' THEN today
          WHEN 'month' THEN today
          ELSE COALESCE(${input.to ?? null}::date, ${input.from ?? null}::date, today)
        END AS to_day
      FROM company
    )
    SELECT timezone, today::text AS today,
      from_day::text AS "fromDay", to_day::text AS "toDay",
      (from_day::timestamp AT TIME ZONE timezone) AS "fromAt",
      ((to_day + 1)::timestamp AT TIME ZONE timezone) AS "toAt",
      (to_day - from_day)::int AS days
    FROM days`;
  if (!period) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
  if (period.days < 0 || period.days > 366) throw periodInvalid();
  return {
    timezone: period.timezone,
    today: period.today,
    fromDay: period.fromDay,
    toDay: period.toDay,
    fromAt: period.fromAt,
    toAt: period.toAt,
  };
}

function periodInvalid() {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { from: ['请选择 1 至 366 天内的日期范围。'] },
  });
}
