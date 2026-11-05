import { Prisma } from '@crm/database';
import type { RecordListDateFilter } from './records.repository';

/** Only year-first dates are interpreted; malformed legacy values remain NULL. */
export function recordDateExpression(
  value: Prisma.Sql,
  type: 'DATE' | 'DATETIME' | 'DATE_TEXT',
): Prisma.Sql {
  if (type === 'DATETIME')
    return Prisma.sql`
    CASE WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      AND pg_input_is_valid(${value}, 'timestamp with time zone')
      THEN (${value})::timestamptz ELSE NULL END`;
  const raw = type === 'DATE' ? value : Prisma.sql`btrim(${value})`;
  const format =
    type === 'DATE'
      ? Prisma.sql`${raw} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`
      : Prisma.sql`${raw} ~ '^([0-9]{4}|[0-9]{2})([./-])([0-9]{1,2})\\2([0-9]{1,2})$'`;
  // Scalar string operations avoid a correlated parser subplan per row and bound.
  const normalized =
    type === 'DATE'
      ? raw
      : Prisma.sql`translate(CASE WHEN ${raw} ~ '^[0-9]{2}[./-]'
        THEN '20' || ${raw} ELSE ${raw} END, './', '--')`;
  return Prisma.sql`CASE WHEN ${format}
    AND pg_input_is_valid(${normalized}, 'date') THEN (${normalized})::date ELSE NULL END`;
}

export function recordDatePredicate(
  value: Prisma.Sql,
  filter: RecordListDateFilter,
  tenantId: string,
): Prisma.Sql {
  const expression = recordDateExpression(value, filter.dateType ?? 'DATE');
  // Tenant-owned timezone is authoritative for relative dates and DATETIME boundaries.
  const timezone = Prisma.sql`(SELECT timezone FROM tenants WHERE id = ${tenantId}::uuid)`;
  let from = filter.from ? Prisma.sql`${filter.from}::date` : undefined;
  let to = filter.to ? Prisma.sql`${filter.to}::date` : undefined;
  if (filter.relative) {
    const today = Prisma.sql`(${filter.asOf}::timestamptz AT TIME ZONE ${timezone})::date`;
    from = today;
    to = today;
    switch (filter.relative) {
      case 'yesterday':
        from = to = Prisma.sql`(${today} - 1)`;
        break;
      case 'past_7_days':
        from = Prisma.sql`(${today} - 6)`;
        break;
      case 'past_30_days':
        from = Prisma.sql`(${today} - 29)`;
        break;
      case 'this_week':
        from = Prisma.sql`date_trunc('week', ${today}::timestamp)::date`;
        to = Prisma.sql`(${from} + 6)`;
        break;
      case 'this_month':
        from = Prisma.sql`date_trunc('month', ${today}::timestamp)::date`;
        to = Prisma.sql`(${from} + interval '1 month' - interval '1 day')::date`;
        break;
      case 'last_month':
        to = Prisma.sql`(date_trunc('month', ${today}::timestamp)::date - 1)`;
        from = Prisma.sql`date_trunc('month', ${to}::timestamp)::date`;
        break;
    }
  }
  const bounds: Prisma.Sql[] = [];
  if (filter.dateType === 'DATETIME') {
    if (from)
      bounds.push(
        Prisma.sql`${expression} >= (${from}::timestamp AT TIME ZONE ${timezone})`,
      );
    if (to)
      bounds.push(
        Prisma.sql`${expression} < ((${to} + 1)::timestamp AT TIME ZONE ${timezone})`,
      );
  } else {
    if (from) bounds.push(Prisma.sql`${expression} >= ${from}`);
    if (to) bounds.push(Prisma.sql`${expression} <= ${to}`);
  }
  return bounds.length ? Prisma.join(bounds, ' AND ') : Prisma.sql`FALSE`;
}
