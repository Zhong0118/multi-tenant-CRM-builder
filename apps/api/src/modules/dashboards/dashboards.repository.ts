import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { parsePublishedObjectSchema } from '../objects/published-object.service';
import type {
  DashboardAggregateInput,
  DashboardAggregateResult,
  DashboardConfiguration,
  DashboardConfigurationRecord,
  DashboardPublishedObject,
} from './dashboard.types';
import type { DashboardRepository } from './dashboards.service';

@Injectable()
export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  getConfiguration(
    context: TenantContext,
  ): Promise<DashboardConfigurationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const record = await transaction.tenantDashboardConfiguration.findUnique({
        where: { tenantId: context.tenantId },
      });
      return record
        ? {
            version: record.version,
            configuration: structuredClone(
              record.configuration,
            ) as unknown as DashboardConfiguration,
            updatedAt: record.updatedAt.toISOString(),
          }
        : null;
    });
  }

  saveConfiguration(
    context: TenantContext,
    expectedVersion: number,
    configuration: DashboardConfiguration,
  ): Promise<DashboardConfigurationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ version: number }>>`
        SELECT version
        FROM tenant_dashboard_configurations
        WHERE tenant_id = ${context.tenantId}::uuid
        FOR UPDATE
      `;
      const currentVersion = locked[0]?.version;
      if (
        (currentVersion === undefined && expectedVersion !== 0) ||
        (currentVersion !== undefined && currentVersion !== expectedVersion)
      ) {
        return null;
      }

      const json = configuration as unknown as Prisma.InputJsonValue;
      const record =
        currentVersion === undefined
          ? await transaction.tenantDashboardConfiguration.create({
              data: {
                tenantId: context.tenantId,
                version: 1,
                configuration: json,
              },
            })
          : await transaction.tenantDashboardConfiguration.update({
              where: { tenantId: context.tenantId },
              data: { version: { increment: 1 }, configuration: json },
            });
      return {
        version: record.version,
        configuration: structuredClone(
          record.configuration,
        ) as unknown as DashboardConfiguration,
        updatedAt: record.updatedAt.toISOString(),
      };
    });
  }

  listPublishedObjects(
    context: TenantContext,
  ): Promise<DashboardPublishedObject[]> {
    return this.runner.withTenant(context, async (transaction) => {
      const objects = await transaction.objectDefinition.findMany({
        where: {
          tenantId: context.tenantId,
          status: 'ACTIVE',
          activePublicationId: { not: null },
        },
        select: {
          activePublication: { select: { configuration: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return objects.flatMap((object) =>
        object.activePublication
          ? [parsePublishedObjectSchema(object.activePublication.configuration)]
          : [],
      );
    });
  }

  aggregateOverview(
    context: TenantContext,
    input: DashboardAggregateInput,
  ): Promise<DashboardAggregateResult> {
    return this.runner.withTenant(context, async (transaction) => {
      const opportunity = input.configuration.opportunity;
      const objectId = input.opportunity.object.id;
      const owner = input.ownerMemberId;
      const ownerClause = owner
        ? Prisma.sql`AND r.owner_member_id = ${owner}::uuid`
        : Prisma.empty;
      const amount = amountExpression(opportunity.amountFieldKey);
      const businessDate = dateExpression(opportunity.dateFieldKey);
      const active = opportunity.activeOptionKeys;
      const won = opportunity.wonOptionKeys;
      const lost = opportunity.lostOptionKeys;

      const [summaryRows, pipelineRows, trendRows, attentionRows, recordRows] =
        await Promise.all([
          transaction.$queryRaw<SummaryRow[]>(Prisma.sql`
            SELECT
              COUNT(*) FILTER (
                WHERE r.created_at >= ${input.period.from}::timestamptz
                  AND r.created_at < ${input.period.to}::timestamptz
              )::int AS "newCount",
              COUNT(*) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(active)})
              )::int AS "activeCount",
              COALESCE(SUM(${amount}) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(active)})
              ), 0)::double precision AS "activeAmount",
              COUNT(*) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(won)})
                  AND ${businessDate} >= ${input.period.from}::timestamptz
                  AND ${businessDate} < ${input.period.to}::timestamptz
              )::int AS "wonCount",
              COALESCE(SUM(${amount}) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(won)})
                  AND ${businessDate} >= ${input.period.from}::timestamptz
                  AND ${businessDate} < ${input.period.to}::timestamptz
              ), 0)::double precision AS "wonAmount",
              COUNT(*) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(lost)})
                  AND ${businessDate} >= ${input.period.from}::timestamptz
                  AND ${businessDate} < ${input.period.to}::timestamptz
              )::int AS "lostCount"
            FROM records r
            WHERE r.tenant_id = ${context.tenantId}::uuid
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
              ${ownerClause}
          `),
          transaction.$queryRaw<PipelineRow[]>(Prisma.sql`
            SELECT
              r.data ->> ${opportunity.stageFieldKey} AS "optionKey",
              COUNT(*)::int AS count,
              COALESCE(SUM(${amount}), 0)::double precision AS amount
            FROM records r
            WHERE r.tenant_id = ${context.tenantId}::uuid
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
              AND r.data ->> ${opportunity.stageFieldKey}
                IN (${Prisma.join([...active, ...won, ...lost])})
              ${ownerClause}
            GROUP BY 1
          `),
          transaction.$queryRaw<TrendRow[]>(Prisma.sql`
            SELECT
              to_char(
                date_trunc('day', ${businessDate} AT TIME ZONE ${input.period.timezone}),
                'YYYY-MM-DD'
              ) AS date,
              COUNT(*)::int AS "wonCount",
              COALESCE(SUM(${amount}), 0)::double precision AS "wonAmount"
            FROM records r
            WHERE r.tenant_id = ${context.tenantId}::uuid
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
              AND r.data ->> ${opportunity.stageFieldKey}
                IN (${Prisma.join(won)})
              AND ${businessDate} >= ${input.period.from}::timestamptz
              AND ${businessDate} < ${input.period.to}::timestamptz
              ${ownerClause}
            GROUP BY 1
            ORDER BY date ASC
          `),
          transaction.$queryRaw<AttentionRow[]>(Prisma.sql`
            SELECT
              COUNT(*) FILTER (
                WHERE r.owner_member_id IS NULL
                  AND r.data ->> ${opportunity.stageFieldKey}
                    IN (${Prisma.join(active)})
              )::int AS unassigned,
              COUNT(*) FILTER (
                WHERE r.updated_at < NOW() - INTERVAL '7 days'
                  AND r.data ->> ${opportunity.stageFieldKey}
                    IN (${Prisma.join(active)})
              )::int AS stale,
              COUNT(*) FILTER (
                WHERE ${businessDate} < NOW()
                  AND r.data ->> ${opportunity.stageFieldKey}
                    IN (${Prisma.join(active)})
              )::int AS overdue,
              COUNT(*) FILTER (
                WHERE ${businessDate} >= NOW()
                  AND ${businessDate} < NOW() + INTERVAL '7 days'
                  AND r.data ->> ${opportunity.stageFieldKey}
                    IN (${Prisma.join(active)})
              )::int AS "dueSoon"
            FROM records r
            WHERE r.tenant_id = ${context.tenantId}::uuid
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
              ${ownerClause}
          `),
          transaction.$queryRaw<RecordRow[]>(Prisma.sql`
            SELECT
              r.id::text AS id,
              r.title,
              r.owner_member_id::text AS "ownerMemberId",
              u.display_name AS "ownerName",
              r.data ->> ${opportunity.stageFieldKey} AS "stageKey",
              ${amount}::double precision AS amount,
              ${businessDate}::text AS "dueAt",
              r.updated_at::text AS "updatedAt"
            FROM records r
            LEFT JOIN tenant_members tm
              ON tm.tenant_id = r.tenant_id AND tm.id = r.owner_member_id
            LEFT JOIN users u ON u.id = tm.user_id
            WHERE r.tenant_id = ${context.tenantId}::uuid
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
              AND r.data ->> ${opportunity.stageFieldKey}
                IN (${Prisma.join(active)})
              ${ownerClause}
            ORDER BY
              (${businessDate} < NOW()) DESC,
              ${businessDate} ASC NULLS LAST,
              ${amount} DESC,
              r.updated_at DESC
            LIMIT 10
          `),
        ]);

      const leaderboardRows = input.includeLeaderboard
        ? await transaction.$queryRaw<LeaderboardRow[]>(Prisma.sql`
            SELECT
              tm.id::text AS "memberId",
              u.display_name AS "displayName",
              COUNT(*) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(won)})
                  AND ${businessDate} >= ${input.period.from}::timestamptz
                  AND ${businessDate} < ${input.period.to}::timestamptz
              )::int AS "wonCount",
              COALESCE(SUM(${amount}) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(won)})
                  AND ${businessDate} >= ${input.period.from}::timestamptz
                  AND ${businessDate} < ${input.period.to}::timestamptz
              ), 0)::double precision AS "wonAmount",
              COALESCE(SUM(${amount}) FILTER (
                WHERE r.data ->> ${opportunity.stageFieldKey}
                  IN (${Prisma.join(active)})
              ), 0)::double precision AS "activeAmount"
            FROM tenant_members tm
            JOIN users u ON u.id = tm.user_id
            LEFT JOIN records r
              ON r.tenant_id = tm.tenant_id
              AND r.owner_member_id = tm.id
              AND r.object_id = ${objectId}::uuid
              AND r.deleted_at IS NULL
            WHERE tm.tenant_id = ${context.tenantId}::uuid
              AND tm.status = 'ACTIVE'
              AND tm.role = 'EMPLOYEE'
            GROUP BY tm.id, u.display_name
            ORDER BY "wonAmount" DESC, "wonCount" DESC, u.display_name ASC
          `)
        : [];

      return projectAggregate(
        context,
        input,
        summaryRows[0],
        pipelineRows,
        trendRows,
        attentionRows[0],
        leaderboardRows,
        recordRows,
      );
    });
  }
}

interface SummaryRow {
  newCount: number;
  activeCount: number;
  activeAmount: number;
  wonCount: number;
  wonAmount: number;
  lostCount: number;
}

interface PipelineRow {
  optionKey: string;
  count: number;
  amount: number;
}

interface TrendRow {
  date: string;
  wonCount: number;
  wonAmount: number;
}

interface AttentionRow {
  unassigned: number;
  stale: number;
  overdue: number;
  dueSoon: number;
}

interface LeaderboardRow {
  memberId: string;
  displayName: string;
  wonCount: number;
  wonAmount: number;
  activeAmount: number;
}

interface RecordRow {
  id: string;
  title: string;
  ownerMemberId: string | null;
  ownerName: string | null;
  stageKey: string | null;
  amount: number | null;
  dueAt: string | null;
  updatedAt: string;
}

function amountExpression(fieldKey?: string): Prisma.Sql {
  if (!fieldKey) return Prisma.sql`0::numeric`;
  return Prisma.sql`
    CASE
      WHEN (r.data ->> ${fieldKey}) ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN (r.data ->> ${fieldKey})::numeric
      ELSE 0::numeric
    END
  `;
}

function dateExpression(fieldKey?: string): Prisma.Sql {
  if (!fieldKey) return Prisma.sql`r.updated_at`;
  return Prisma.sql`
    CASE
      WHEN (r.data ->> ${fieldKey}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (r.data ->> ${fieldKey})::timestamptz
      ELSE r.updated_at
    END
  `;
}

function projectAggregate(
  context: TenantContext,
  input: DashboardAggregateInput,
  summary: SummaryRow | undefined,
  pipelineRows: PipelineRow[],
  trend: TrendRow[],
  attention: AttentionRow | undefined,
  leaderboard: LeaderboardRow[],
  records: RecordRow[],
): DashboardAggregateResult {
  const resolved = summary ?? {
    newCount: 0,
    activeCount: 0,
    activeAmount: 0,
    wonCount: 0,
    wonAmount: 0,
    lostCount: 0,
  };
  const stageOptions = optionPresentation(
    input.opportunity,
    input.configuration.opportunity.stageFieldKey,
  );
  const pipelineByKey = new Map(
    pipelineRows.map((row) => [row.optionKey, row]),
  );
  const terminal = resolved.wonCount + resolved.lostCount;
  const listHref = `/workspace/${context.tenantCode}/objects/${input.opportunity.object.code}`;
  const activeFilter = encodeURIComponent(
    JSON.stringify({
      [input.configuration.opportunity.stageFieldKey]:
        input.configuration.opportunity.activeOptionKeys,
    }),
  );
  return {
    metrics: [
      {
        key: 'new',
        label: '本期新增',
        value: resolved.newCount,
        format: 'COUNT',
      },
      {
        key: 'active',
        label: '进行中商机',
        value: resolved.activeCount,
        format: 'COUNT',
      },
      {
        key: 'activeAmount',
        label: '进行中金额',
        value: resolved.activeAmount,
        format: 'MONEY',
      },
      {
        key: 'won',
        label: '成交单数',
        value: resolved.wonCount,
        format: 'COUNT',
      },
      {
        key: 'wonAmount',
        label: '成交金额',
        value: resolved.wonAmount,
        format: 'MONEY',
      },
      {
        key: 'conversion',
        label: '终态成交率',
        value: terminal === 0 ? null : (resolved.wonCount / terminal) * 100,
        format: 'PERCENT',
      },
    ],
    pipeline: [
      ...input.configuration.opportunity.activeOptionKeys,
      ...input.configuration.opportunity.wonOptionKeys,
      ...input.configuration.opportunity.lostOptionKeys,
    ].map((optionKey) => {
      const row = pipelineByKey.get(optionKey);
      const option = stageOptions.get(optionKey);
      return {
        optionKey,
        label: option?.label ?? optionKey,
        color: option?.color ?? 'GRAY',
        count: row?.count ?? 0,
        amount: row?.amount ?? 0,
      };
    }),
    trend,
    attention: [
      {
        key: 'unassigned',
        label: '无人负责',
        count: attention?.unassigned ?? 0,
        href: listHref,
      },
      {
        key: 'stale',
        label: '超过 7 天未更新',
        count: attention?.stale ?? 0,
        href: `${listHref}?filters=${activeFilter}`,
      },
      {
        key: 'overdue',
        label: '已过预计日期',
        count: attention?.overdue ?? 0,
        href: `${listHref}?filters=${activeFilter}`,
      },
      {
        key: 'dueSoon',
        label: '7 天内到期',
        count: attention?.dueSoon ?? 0,
        href: `${listHref}?filters=${activeFilter}`,
      },
    ],
    leaderboard,
    records,
  };
}

function optionPresentation(
  object: DashboardPublishedObject,
  stageFieldKey: string,
) {
  const stageField = object.fields.find(
    (field) => field.fieldKey === stageFieldKey,
  );
  const options = stageField?.config.options;
  if (!Array.isArray(options))
    return new Map<string, { label: string; color: string }>();
  return new Map(
    options.flatMap((value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [];
      }
      const option = value as Record<string, unknown>;
      return typeof option.key === 'string' && typeof option.label === 'string'
        ? [
            [
              option.key,
              {
                label: option.label,
                color: typeof option.color === 'string' ? option.color : 'GRAY',
              },
            ] as const,
          ]
        : [];
    }),
  );
}
