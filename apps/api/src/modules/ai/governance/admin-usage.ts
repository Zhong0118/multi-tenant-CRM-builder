import { monthlyCosts } from './model-cost';
import { readCatalog } from './feature-catalog';
import { Prisma } from '@crm/database';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { inputs, outputs } from './admin.contract';

export type Tx = Prisma.TransactionClient;
export type Company = z.infer<typeof outputs.tenant>;
export const digest = (...values: unknown[]) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');
export function conflict(
  message = '设置或确认摘要已变化，请刷新后重新确认。',
): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, { message });
}
export function invalid(message: string): never {
  throw new ApiException('VALIDATION_FAILED', 400, { message });
}
export function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
export const recover = (tx: Tx, id: string) =>
  tx.$queryRaw`SELECT ai_recover_expired(${id}::uuid)`;

// Compute the ratio before pagination. Numeric arithmetic also preserves exact
// comparisons at the warning thresholds and avoids overflowing bigint sums.
const companyFrom = Prisma.sql`
 FROM tenants t JOIN tenant_ai_configs c ON c.tenant_id=t.id
 CROSS JOIN ai_platform_settings s
 LEFT JOIN ai_plans p ON p.id=c.plan_id
 CROSS JOIN LATERAL (SELECT date_trunc('month', now() AT TIME ZONE t.timezone)::date AS month) clock
 LEFT JOIN ai_tenant_months m ON m.tenant_id=t.id AND m.month=clock.month
 CROSS JOIN LATERAL (SELECT CASE WHEN p.id IS NULL THEN 0 ELSE p.monthly_tokens::numeric+coalesce(m.extra_tokens,0) END AS total,
   coalesce(m.input_tokens,0)::numeric+coalesce(m.output_tokens,0) AS used,coalesce(m.reserved_tokens,0) AS reserved) budget`;
const companySelect = Prisma.sql`SELECT t.id AS "tenantId",t.name,t.code,clock.month::text,
 ((clock.month+interval '1 month') AT TIME ZONE t.timezone) AS "restoresAt",s.created_at AS "startedAt",
 p.id AS "planId",p.name AS "planName",p.version AS "planVersion",coalesce(p.features,'{}') AS features,c.allocation,c.version,
 coalesce(p.monthly_tokens,0)::text AS "baseTokens",coalesce(m.extra_tokens,0)::text AS "extraTokens",budget.total::text AS "totalTokens",
 budget.used::text AS "usedTokens",budget.reserved::text AS "reservedTokens",greatest(0,budget.total-budget.used-budget.reserved)::text AS "remainingTokens",
 (100*budget.used/nullif(budget.total,0))::float8 AS percent`;
type CompanyRow = Omit<Company, 'restoresAt' | 'startedAt'> & {
  restoresAt: Date;
  startedAt: Date;
};
const present = (row: CompanyRow): Company => ({
  ...row,
  restoresAt: row.restoresAt.toISOString(),
  startedAt: row.startedAt.toISOString(),
});
export async function company(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<CompanyRow[]>(
    Prisma.sql`${companySelect} ${companyFrom} WHERE t.id=${id}::uuid`,
  );
  if (!row) throw new ApiException('TENANT_NOT_FOUND', 404);
  return present(row);
}
export async function pageBudgets(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx.$queryRaw<
    { tenantId: string; planName: string | null; percent: number | null }[]
  >(
    Prisma.sql`SELECT t.id AS "tenantId",p.name AS "planName", (100*budget.used/nullif(budget.total,0))::float8 AS percent ${companyFrom} WHERE t.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`,
  );
}
export async function companies(tx: Tx, q: z.infer<typeof inputs.companies>) {
  await tx.$queryRaw`SELECT ai_recover_platform_expired()`;
  const where = Prisma.sql`WHERE (${q.status ?? null}::text IS NULL OR t.status::text=${q.status ?? null}) AND
 (${q.search ?? ''}='' OR strpos(lower(t.name),lower(${q.search ?? ''}))>0 OR strpos(lower(t.code),lower(${q.search ?? ''}))>0)`;
  const [{ total }] = await tx.$queryRaw<{ total: number }[]>(
    Prisma.sql`SELECT count(*)::int AS total FROM tenants t ${where}`,
  );
  const rows = await tx.$queryRaw<
    CompanyRow[]
  >(Prisma.sql`${companySelect} ${companyFrom} ${where}
 ORDER BY budget.used/nullif(budget.total,0) ${q.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`} NULLS LAST,t.id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`);
  return { items: rows.map(present), total, page: q.page, limit: q.limit };
}
export async function daily(tx: Tx, id: string, month: string) {
  return tx.$queryRaw<
    z.infer<typeof outputs.usage>['daily']
  >`SELECT local_date::text AS date,feature,calls::text,input_tokens::text AS "inputTokens",
 output_tokens::text AS "outputTokens",proposals::text,confirmations::text FROM ai_daily_usage WHERE tenant_id=${id}::uuid AND local_date>=${month}::date
 AND local_date<${month}::date+interval '1 month' ORDER BY local_date,feature`;
}
export async function platformUsage(tx: Tx, id: string) {
  await recover(tx, id);
  const current = await company(tx, id);
  const trend = await tx.$queryRaw<
    z.infer<typeof outputs.summary>['trend']
  >`SELECT d::date::text AS month,(coalesce(m.input_tokens,0)::numeric+coalesce(m.output_tokens,0))::text AS "usedTokens"
 FROM generate_series(${current.month}::date-interval '5 months',${current.month}::date::timestamp,interval '1 month') d
 LEFT JOIN ai_tenant_months m ON m.month=d::date AND m.tenant_id=${id}::uuid ORDER BY d`;
  return {
    ...current,
    costs: await monthlyCosts(tx, id, current.month),
    catalog: await readCatalog(tx),
    trend,
    usage: await daily(tx, id, current.month),
  };
}
export async function members(tx: Tx, id: string, month: string) {
  return tx.$queryRaw<
    z.infer<typeof outputs.usage>['members']
  >`SELECT tm.id AS "memberId",coalesce(tm.display_name,u.display_name) AS name,
 (tm.status='ACTIVE' AND u.status='ACTIVE') AS active,(coalesce(m.input_tokens,0)::numeric+coalesce(m.output_tokens,0))::text AS "usedTokens",
 coalesce(m.reserved_tokens,0)::text AS "reservedTokens" FROM tenant_members tm JOIN users u ON u.id=tm.user_id
 LEFT JOIN ai_member_months m ON m.tenant_id=tm.tenant_id AND m.member_id=tm.id AND m.month=${month}::date
 WHERE tm.tenant_id=${id}::uuid AND ((tm.status='ACTIVE' AND u.status='ACTIVE') OR m.member_id IS NOT NULL)
 ORDER BY (coalesce(m.input_tokens,0)::numeric+coalesce(m.output_tokens,0)) DESC,tm.id`;
}
export function previewAllocation(
  c: Company,
  rows: z.infer<typeof outputs.usage>['members'],
) {
  const active = rows.filter((r) => r.active);
  const share = active.length
    ? BigInt(c.totalTokens) / BigInt(active.length)
    : null;
  const overShare =
    share === null
      ? 0
      : active.filter((r) => BigInt(r.usedTokens) > share).length;
  return {
    members: active.length,
    shareTokens: share?.toString() ?? null,
    overShare,
    confirmation: digest(
      c.tenantId,
      c.month,
      c.version,
      c.planId,
      c.planVersion,
      c.totalTokens,
      active.map((m) => m.memberId).sort(),
      overShare,
    ),
  };
}
export function usageNotice(
  c: Company,
  personal: { limit: bigint; used: bigint; reserved: bigint } | null,
) {
  if (!c.planId || BigInt(c.totalTokens) === 0n)
    return { notice: null, percent: null, remainingTokens: null };
  if (personal) {
    const { limit, used, reserved } = personal;
    return {
      notice: 'personal' as const,
      percent: limit > 0n ? Number((used * 10000n) / limit) / 100 : null,
      remainingTokens: (limit > used + reserved
        ? limit - used - reserved
        : 0n
      ).toString(),
    };
  }
  const ratio = (BigInt(c.usedTokens) * 100n) / BigInt(c.totalTokens);
  if (ratio < 80n)
    return { notice: null, percent: null, remainingTokens: null };
  return {
    notice:
      ratio >= 100n
        ? ('company_exhausted' as const)
        : ('company_warning' as const),
    percent: c.percent,
    remainingTokens: null,
  };
}
export async function capabilities(tx: Tx, c: TenantContext) {
  await recover(tx, c.tenantId);
  const state = await company(tx, c.tenantId);
  const [{ disabled }] = await tx.$queryRaw<
    { disabled: boolean }[]
  >`SELECT disabled FROM ai_platform_settings`;
  let personal = null;
  if (state.allocation === 'equal') {
    const [{ n }] = await tx.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM tenant_members t JOIN users u ON u.id=t.user_id WHERE t.tenant_id=${c.tenantId}::uuid AND t.status='ACTIVE' AND u.status='ACTIVE'`;
    const [row] = await tx.$queryRaw<
      { used: string; reserved: bigint }[]
    >`SELECT (input_tokens::numeric+output_tokens)::text AS used,reserved_tokens AS reserved FROM ai_member_months WHERE tenant_id=${c.tenantId}::uuid AND member_id=${c.memberId}::uuid AND month=${state.month}::date`;
    personal = {
      limit: n ? BigInt(state.totalTokens) / n : 0n,
      used: BigInt(row?.used ?? 0),
      reserved: row?.reserved ?? 0n,
    };
  }
  return {
    features: disabled
      ? []
      : state.features.filter(
          (f) => f !== 'table_builder' || c.role === 'TENANT_ADMIN',
        ),
    disabled,
    allocation: state.allocation,
    restoresAt: state.restoresAt,
    ...usageNotice(state, personal),
  };
}
