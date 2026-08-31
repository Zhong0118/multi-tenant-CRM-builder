import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { parsePublishedObjectSchema } from '../objects/published-object.service';
import { migrateLegacyDashboard } from './dashboard-definition';
import type {
  DashboardQueryExecutor,
  DashboardQueryPlan,
} from './dashboard-engine';
import type {
  DashboardAggregateInput,
  DashboardAggregateResult,
  DashboardConfiguration,
  DashboardConfigurationRecord,
  DashboardDefinitionV2,
  DashboardDistributionWidgetResult,
  DashboardLeaderboardWidgetResult,
  DashboardMetricWidgetResult,
  DashboardPublishedObject,
  DashboardRecordListWidgetResult,
  DashboardTrendWidgetResult,
  DashboardWidgetResult,
  PublishedDashboardDefinitionV2,
  StoredDashboardPublicationConfiguration,
} from './dashboard.types';
import type { DashboardRepository } from './dashboards.service';

export type { StoredDashboardPublicationConfiguration } from './dashboard.types';

export interface DashboardDefinitionRecord {
  draftVersion: number;
  draftConfiguration: DashboardDefinitionV2;
  activePublicationId: string | null;
  sourceTemplateVersionId: string | null;
  updatedAt: string;
}

export interface DashboardPublicationRecord {
  id: string;
  number: number;
  sourceDraftVersion: number;
  configuration: StoredDashboardPublicationConfiguration;
  publishedByMemberId: string | null;
  publishedAt: string;
}

@Injectable()
export class PrismaDashboardQueryExecutor implements DashboardQueryExecutor {
  constructor(private readonly runner: DatabaseContextRunner) {}

  async execute(
    context: TenantContext,
    plans: DashboardQueryPlan[],
  ): Promise<Map<string, DashboardWidgetResult>> {
    const settled = await Promise.allSettled(
      plans.map((plan) =>
        this.runner.withTenant(context, (transaction) =>
          executePlan(transaction, context, plan),
        ),
      ),
    );
    return new Map(
      plans.map((plan, index) => {
        const result = settled[index];
        return [
          plan.widget.id,
          result?.status === 'fulfilled'
            ? result.value
            : unavailableResult(plan),
        ];
      }),
    );
  }
}

@Injectable()
export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  getDefinition(
    context: TenantContext,
  ): Promise<DashboardDefinitionRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const record = await transaction.tenantDashboardConfiguration.findUnique({
        where: { tenantId: context.tenantId },
      });
      return record ? definitionRecord(record) : null;
    });
  }

  saveDraft(
    context: TenantContext,
    expectedVersion: number,
    draft: DashboardDefinitionV2,
  ): Promise<DashboardDefinitionRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const currentVersion = await lockDashboardDefinition(
        transaction,
        context.tenantId,
      );
      if (
        (currentVersion === undefined && expectedVersion !== 0) ||
        (currentVersion !== undefined && currentVersion !== expectedVersion)
      ) {
        return null;
      }

      const draftConfiguration = draft as unknown as Prisma.InputJsonValue;
      const record =
        currentVersion === undefined
          ? await transaction.tenantDashboardConfiguration.create({
              data: {
                tenantId: context.tenantId,
                draftVersion: 1,
                draftConfiguration,
              },
            })
          : await transaction.tenantDashboardConfiguration.update({
              where: { tenantId: context.tenantId },
              data: {
                draftVersion: { increment: 1 },
                draftConfiguration,
              },
            });
      return definitionRecord(record);
    });
  }

  publishDraft(
    context: TenantContext,
    expectedVersion: number,
    compiled: PublishedDashboardDefinitionV2,
    actorMemberId: string,
  ): Promise<DashboardPublicationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const currentVersion = await lockDashboardDefinition(
        transaction,
        context.tenantId,
      );
      if (currentVersion !== expectedVersion) return null;

      const numbers = await transaction.$queryRaw<Array<{ number: number }>>`
        SELECT COALESCE(MAX(publication_no), 0)::int + 1 AS number
        FROM tenant_dashboard_publications
        WHERE tenant_id = ${context.tenantId}::uuid
      `;
      const publication = await transaction.tenantDashboardPublication.create({
        data: {
          tenantId: context.tenantId,
          publicationNo: numbers[0]?.number ?? 1,
          sourceDraftVersion: expectedVersion,
          configuration: compiled as unknown as Prisma.InputJsonValue,
          publishedByMemberId: actorMemberId,
        },
      });
      await transaction.tenantDashboardConfiguration.update({
        where: { tenantId: context.tenantId },
        data: { activePublicationId: publication.id },
      });
      return publicationRecord(publication);
    });
  }

  getActivePublication(
    context: TenantContext,
  ): Promise<DashboardPublicationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const definition =
        await transaction.tenantDashboardConfiguration.findUnique({
          where: { tenantId: context.tenantId },
          select: { activePublication: true },
        });
      return definition?.activePublication
        ? publicationRecord(definition.activePublication)
        : null;
    });
  }

  getConfiguration(
    context: TenantContext,
  ): Promise<DashboardConfigurationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const record = await transaction.tenantDashboardConfiguration.findUnique({
        where: { tenantId: context.tenantId },
      });
      return record
        ? {
            version: record.draftVersion,
            configuration: structuredClone(
              record.draftConfiguration,
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
      const currentVersion = await lockDashboardDefinition(
        transaction,
        context.tenantId,
      );
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
                draftVersion: 1,
                draftConfiguration: json,
              },
            })
          : await transaction.tenantDashboardConfiguration.update({
              where: { tenantId: context.tenantId },
              data: {
                draftVersion: { increment: 1 },
                draftConfiguration: json,
              },
            });
      return {
        version: record.draftVersion,
        configuration: structuredClone(
          record.draftConfiguration,
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

async function executePlan(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan,
): Promise<DashboardWidgetResult> {
  switch (plan.widget.type) {
    case 'METRIC':
      return executeMetric(transaction, context, {
        ...plan,
        widget: plan.widget,
      });
    case 'STATUS_DISTRIBUTION':
      return executeDistribution(transaction, context, {
        ...plan,
        widget: plan.widget,
      });
    case 'TREND':
      return executeTrend(transaction, context, {
        ...plan,
        widget: plan.widget,
      });
    case 'LEADERBOARD':
      return executeLeaderboard(transaction, context, {
        ...plan,
        widget: plan.widget,
      });
    case 'RECORD_LIST':
      return executeRecordList(transaction, context, {
        ...plan,
        widget: plan.widget,
      });
  }
}

async function executeMetric(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'METRIC' }>;
  },
): Promise<DashboardMetricWidgetResult> {
  const rows = await transaction.$queryRaw<Array<{ value: number | null }>>(
    Prisma.sql`
      SELECT ${aggregateExpression(
        plan.widget.aggregation,
        plan.widget.valueFieldKey,
      )} AS value
      FROM records r
      WHERE ${commonPredicates(context, plan)}
    `,
  );
  return {
    ...resultPresentation(plan),
    type: 'METRIC',
    state: 'READY',
    data: {
      value: rows[0]?.value ?? null,
      ...(plan.widget.displayFormat
        ? { format: plan.widget.displayFormat }
        : {}),
    },
  };
}

async function executeDistribution(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan & {
    widget: Extract<
      DashboardQueryPlan['widget'],
      { type: 'STATUS_DISTRIBUTION' }
    >;
  },
): Promise<DashboardDistributionWidgetResult> {
  const optionClause = plan.widget.optionKeys.length
    ? Prisma.sql`AND r.data ->> ${plan.widget.groupByFieldKey} IN (${Prisma.join(
        plan.widget.optionKeys,
      )})`
    : Prisma.sql`AND FALSE`;
  const rows = await transaction.$queryRaw<
    Array<{ optionKey: string; value: number }>
  >(Prisma.sql`
    SELECT
      r.data ->> ${plan.widget.groupByFieldKey} AS "optionKey",
      ${aggregateExpression(
        plan.widget.aggregation,
        plan.widget.valueFieldKey,
      )} AS value
    FROM records r
    WHERE ${commonPredicates(context, plan)}
      ${optionClause}
    GROUP BY 1
  `);
  const values = new Map(rows.map((row) => [row.optionKey, row.value]));
  const options = new Map(
    (plan.widget.options ?? []).map((option) => [option.key, option]),
  );
  return {
    ...resultPresentation(plan),
    type: 'STATUS_DISTRIBUTION',
    state: 'READY',
    data: {
      display: plan.widget.display,
      items: plan.widget.optionKeys.map((optionKey) => ({
        optionKey,
        label: options.get(optionKey)?.label ?? optionKey,
        color: options.get(optionKey)?.color ?? 'GRAY',
        value: values.get(optionKey) ?? 0,
      })),
    },
  };
}

async function executeTrend(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'TREND' }>;
  },
): Promise<DashboardTrendWidgetResult> {
  const dateType = plan.widget.dateField?.type;
  if (dateType !== 'DATE' && dateType !== 'DATETIME') {
    throw new Error('Compiled dashboard date metadata missing');
  }
  const date = dashboardDateExpression(plan.widget.dateFieldKey, dateType);
  const granularity = trendGranularity(plan);
  const bucket =
    dateType === 'DATE'
      ? Prisma.sql`${date}::timestamp`
      : Prisma.sql`${date} AT TIME ZONE ${plan.period.timezone}`;
  const rows = await transaction.$queryRaw<
    Array<{ date: string; value: number }>
  >(Prisma.sql`
    SELECT
      to_char(
        date_trunc(${granularity}, ${bucket}),
        'YYYY-MM-DD'
      ) AS date,
      ${aggregateExpression(
        plan.widget.aggregation,
        plan.widget.valueFieldKey,
      )} AS value
    FROM records r
    WHERE ${commonPredicates(context, plan)}
      AND ${trendPeriodPredicate(date, dateType, plan)}
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return {
    ...resultPresentation(plan),
    type: 'TREND',
    state: 'READY',
    data: { items: rows },
  };
}

async function executeLeaderboard(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'LEADERBOARD' }>;
  },
): Promise<DashboardLeaderboardWidgetResult> {
  const member =
    plan.widget.memberSource === 'RECORD_OWNER'
      ? Prisma.sql`r.owner_member_id::text`
      : Prisma.sql`r.data ->> ${plan.widget.memberFieldKey!}`;
  const rows = await transaction.$queryRaw<
    Array<{ memberId: string; displayName: string; value: number }>
  >(Prisma.sql`
    WITH dashboard_records AS (
      SELECT r.*, ${member} AS dashboard_member_id
      FROM records r
      WHERE ${commonPredicates(context, plan)}
    )
    SELECT
      r.dashboard_member_id AS "memberId",
      COALESCE(u.display_name, r.dashboard_member_id) AS "displayName",
      ${aggregateExpression(
        plan.widget.aggregation,
        plan.widget.valueFieldKey,
      )} AS value
    FROM dashboard_records r
    LEFT JOIN tenant_members tm
      ON tm.tenant_id = r.tenant_id
      AND tm.id::text = r.dashboard_member_id
      AND tm.status = 'ACTIVE'
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE r.dashboard_member_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY value DESC, "displayName" ASC, "memberId" ASC
    LIMIT ${plan.widget.limit}
  `);
  return {
    ...resultPresentation(plan),
    type: 'LEADERBOARD',
    state: 'READY',
    data: { items: rows },
  };
}

async function executeRecordList(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'RECORD_LIST' }>;
  },
): Promise<DashboardRecordListWidgetResult> {
  const direction =
    plan.widget.sort.direction === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const rows = await transaction.$queryRaw<
    Array<{
      id: string;
      recordNo: string;
      title: string;
      ownerMemberId: string | null;
      ownerName: string | null;
      updatedAt: string;
      values: Record<string, unknown>;
    }>
  >(Prisma.sql`
    SELECT
      r.id::text AS id,
      r.record_no::text AS "recordNo",
      r.title,
      r.owner_member_id::text AS "ownerMemberId",
      u.display_name AS "ownerName",
      to_char(
        r.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS "updatedAt",
      COALESCE((
        SELECT jsonb_object_agg(entry.key, entry.value)
        FROM jsonb_each(r.data) entry
        WHERE entry.key IN (${Prisma.join(plan.visibleFieldKeys)})
      ), '{}'::jsonb) AS values
    FROM records r
    LEFT JOIN tenant_members tm
      ON tm.tenant_id = r.tenant_id AND tm.id = r.owner_member_id
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE ${commonPredicates(context, plan)}
    ORDER BY ${recordSortExpression(plan)} ${direction}, r.id ${direction}
    LIMIT ${plan.widget.limit}
  `);
  const visible = new Set(plan.visibleFieldKeys);
  return {
    ...resultPresentation(plan),
    type: 'RECORD_LIST',
    state: 'READY',
    data: {
      fields: (plan.widget.displayFields ?? []).filter((field) =>
        visible.has(field.fieldKey),
      ),
      items: rows,
    },
  };
}

function commonPredicates(
  context: TenantContext,
  plan: DashboardQueryPlan,
): Prisma.Sql {
  const owner = plan.ownerMemberId
    ? Prisma.sql`AND r.owner_member_id = ${plan.ownerMemberId}::uuid`
    : Prisma.empty;
  const filters = plan.widget.filters.map((filter) =>
    filterPredicate(plan, context, filter),
  );
  const filterClause = filters.length
    ? Prisma.join(
        filters.map((filter) => Prisma.sql`AND ${filter}`),
        ' ',
      )
    : Prisma.empty;
  return Prisma.sql`
    r.tenant_id = ${context.tenantId}::uuid
    AND r.object_id = ${plan.object.object.id}::uuid
    AND r.deleted_at IS NULL
    ${owner}
    ${filterClause}
  `;
}

function filterPredicate(
  plan: DashboardQueryPlan,
  context: TenantContext,
  filter: DashboardQueryPlan['widget']['filters'][number],
): Prisma.Sql {
  const field = plan.widget.filterFields.find(
    (candidate) => candidate.fieldKey === filter.fieldKey,
  );
  if (!field) throw new Error('Compiled dashboard filter metadata missing');
  const text = Prisma.sql`r.data ->> ${filter.fieldKey}`;
  const values = Array.isArray(filter.value) ? filter.value : [];

  if (field.type === 'SINGLE_SELECT') {
    return membershipPredicate(text, filter.operator, values.map(String));
  }
  if (field.type === 'MULTI_SELECT') {
    const members = values.map(String);
    if (members.length === 0) {
      return filter.operator === 'NOT_IN'
        ? Prisma.sql`TRUE`
        : Prisma.sql`FALSE`;
    }
    const exists = Prisma.sql`
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(r.data -> ${filter.fieldKey}) = 'array'
            THEN r.data -> ${filter.fieldKey}
            ELSE '[]'::jsonb
          END
        ) item(value)
        WHERE item.value IN (${Prisma.join(members)})
      )
    `;
    return filter.operator === 'NOT_IN' ? Prisma.sql`NOT (${exists})` : exists;
  }
  if (field.type === 'NUMBER' || field.type === 'MONEY') {
    const number = dashboardNumericExpression(filter.fieldKey);
    if (filter.operator === 'BETWEEN') {
      return Prisma.sql`${number} BETWEEN ${values[0]}::numeric AND ${values[1]}::numeric`;
    }
    return comparisonPredicate(number, filter.operator, filter.value);
  }
  if (field.type === 'DATE' || field.type === 'DATETIME') {
    return dateFilterPredicate(
      dashboardDateExpression(filter.fieldKey, field.type),
      field.type,
      filter.operator,
      filter.value,
      plan.period.timezone,
    );
  }
  if (field.type === 'BOOLEAN') {
    return Prisma.sql`${text} = ${String(filter.value)}`;
  }
  if (field.type === 'MEMBER') {
    if (filter.operator === 'CURRENT_USER') {
      return Prisma.sql`${text} = ${context.memberId}`;
    }
    if (filter.operator === 'RECORD_OWNER') {
      return Prisma.sql`${text} = r.owner_member_id::text`;
    }
    return membershipPredicate(text, filter.operator, values.map(String));
  }
  if (filter.operator === 'CONTAINS') {
    return Prisma.sql`${text} ILIKE ${`%${String(filter.value)}%`}`;
  }
  if (filter.operator === 'NOT_EMPTY') {
    return Prisma.sql`NULLIF(BTRIM(${text}), '') IS NOT NULL`;
  }
  return Prisma.sql`${text} = ${String(filter.value)}`;
}

function membershipPredicate(
  expression: Prisma.Sql,
  operator: string,
  values: string[],
): Prisma.Sql {
  if (values.length === 0) {
    return operator === 'NOT_IN' ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
  }
  return operator === 'NOT_IN'
    ? Prisma.sql`${expression} NOT IN (${Prisma.join(values)})`
    : Prisma.sql`${expression} IN (${Prisma.join(values)})`;
}

function comparisonPredicate(
  expression: Prisma.Sql,
  operator: string,
  value: unknown,
): Prisma.Sql {
  switch (operator) {
    case 'GT':
      return Prisma.sql`${expression} > ${value}::numeric`;
    case 'GTE':
      return Prisma.sql`${expression} >= ${value}::numeric`;
    case 'LT':
      return Prisma.sql`${expression} < ${value}::numeric`;
    case 'LTE':
      return Prisma.sql`${expression} <= ${value}::numeric`;
    default:
      return Prisma.sql`${expression} = ${value}::numeric`;
  }
}

function dateFilterPredicate(
  expression: Prisma.Sql,
  type: 'DATE' | 'DATETIME',
  operator: string,
  value: unknown,
  timezone: string,
): Prisma.Sql {
  if (type === 'DATE') {
    return calendarDateFilterPredicate(expression, operator, value, timezone);
  }
  const today = Prisma.sql`date_trunc('day', NOW() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}`;
  const values = Array.isArray(value) ? value : [];
  switch (operator) {
    case 'TODAY':
      return Prisma.sql`${expression} >= ${today} AND ${expression} < ${today} + INTERVAL '1 day'`;
    case 'THIS_WEEK': {
      const start = Prisma.sql`date_trunc('week', NOW() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}`;
      return Prisma.sql`${expression} >= ${start} AND ${expression} < ${start} + INTERVAL '1 week'`;
    }
    case 'THIS_MONTH': {
      const start = Prisma.sql`date_trunc('month', NOW() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}`;
      return Prisma.sql`${expression} >= ${start} AND ${expression} < ${start} + INTERVAL '1 month'`;
    }
    case 'PAST_N_DAYS':
      return Prisma.sql`${expression} >= ${today} - ${Number(value)} * INTERVAL '1 day' AND ${expression} < ${today} + INTERVAL '1 day'`;
    case 'NEXT_N_DAYS':
      return Prisma.sql`${expression} >= ${today} AND ${expression} < ${today} + (${Number(value)} + 1) * INTERVAL '1 day'`;
    default:
      return Prisma.sql`${expression} BETWEEN ${values[0]}::timestamptz AND ${values[1]}::timestamptz`;
  }
}

function calendarDateFilterPredicate(
  expression: Prisma.Sql,
  operator: string,
  value: unknown,
  timezone: string,
): Prisma.Sql {
  const today = Prisma.sql`(NOW() AT TIME ZONE ${timezone})::date`;
  const values = Array.isArray(value) ? value : [];
  switch (operator) {
    case 'TODAY':
      return Prisma.sql`${expression} = ${today}`;
    case 'THIS_WEEK': {
      const start = Prisma.sql`date_trunc('week', NOW() AT TIME ZONE ${timezone})::date`;
      return Prisma.sql`${expression} >= ${start} AND ${expression} < ${start} + 7`;
    }
    case 'THIS_MONTH': {
      const start = Prisma.sql`date_trunc('month', NOW() AT TIME ZONE ${timezone})::date`;
      return Prisma.sql`${expression} >= ${start} AND ${expression} < (${start} + INTERVAL '1 month')::date`;
    }
    case 'PAST_N_DAYS':
      return Prisma.sql`${expression} >= ${today} - ${Number(value)} AND ${expression} <= ${today}`;
    case 'NEXT_N_DAYS':
      return Prisma.sql`${expression} >= ${today} AND ${expression} <= ${today} + ${Number(value)}`;
    default:
      return Prisma.sql`${expression} BETWEEN ${values[0]}::date AND ${values[1]}::date`;
  }
}

function aggregateExpression(
  aggregation: 'COUNT' | 'SUM' | 'AVG',
  fieldKey?: string,
): Prisma.Sql {
  if (aggregation === 'COUNT') return Prisma.sql`COUNT(*)::double precision`;
  const value = dashboardNumericExpression(fieldKey!);
  return aggregation === 'AVG'
    ? Prisma.sql`AVG(${value})::double precision`
    : Prisma.sql`COALESCE(SUM(${value}), 0)::double precision`;
}

function dashboardNumericExpression(fieldKey: string): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN (r.data ->> ${fieldKey}) ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN (r.data ->> ${fieldKey})::numeric
      ELSE NULL
    END
  `;
}

function dashboardDateExpression(
  fieldKey: string,
  type: 'DATE' | 'DATETIME',
): Prisma.Sql {
  return type === 'DATE'
    ? Prisma.sql`
        CASE
          WHEN pg_input_is_valid(r.data ->> ${fieldKey}, 'date')
            THEN (r.data ->> ${fieldKey})::date
          ELSE NULL
        END
      `
    : Prisma.sql`
        CASE
          WHEN pg_input_is_valid(r.data ->> ${fieldKey}, 'timestamptz')
            THEN (r.data ->> ${fieldKey})::timestamptz
          ELSE NULL
        END
      `;
}

function trendPeriodPredicate(
  expression: Prisma.Sql,
  type: 'DATE' | 'DATETIME',
  plan: DashboardQueryPlan,
): Prisma.Sql {
  return type === 'DATE'
    ? Prisma.sql`
        ${expression} >= (${plan.period.from}::timestamptz AT TIME ZONE ${plan.period.timezone})::date
        AND ${expression} < (${plan.period.to}::timestamptz AT TIME ZONE ${plan.period.timezone})::date
      `
    : Prisma.sql`
        ${expression} >= ${plan.period.from}::timestamptz
        AND ${expression} < ${plan.period.to}::timestamptz
      `;
}

function trendGranularity(
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'TREND' }>;
  },
) {
  if (plan.widget.granularity !== 'AUTO') {
    return plan.widget.granularity.toLowerCase();
  }
  const days =
    (new Date(plan.period.to).getTime() -
      new Date(plan.period.from).getTime()) /
    86_400_000;
  return days <= 45 ? 'day' : days <= 180 ? 'week' : 'month';
}

function recordSortExpression(
  plan: DashboardQueryPlan & {
    widget: Extract<DashboardQueryPlan['widget'], { type: 'RECORD_LIST' }>;
  },
): Prisma.Sql {
  switch (plan.widget.sort.field) {
    case 'createdAt':
      return Prisma.sql`r.created_at`;
    case 'updatedAt':
      return Prisma.sql`r.updated_at`;
    case 'recordNo':
      return Prisma.sql`r.record_no`;
    default: {
      const field = plan.widget.sortField;
      return field?.type === 'NUMBER' || field?.type === 'MONEY'
        ? dashboardNumericExpression(plan.widget.sort.field)
        : field?.type === 'DATE' || field?.type === 'DATETIME'
          ? dashboardDateExpression(plan.widget.sort.field, field.type)
          : Prisma.sql`r.data ->> ${plan.widget.sort.field}`;
    }
  }
}

function resultPresentation(plan: DashboardQueryPlan) {
  return {
    id: plan.widget.id,
    title: plan.widget.title,
    ...(plan.widget.description === undefined
      ? {}
      : { description: plan.widget.description }),
    width: plan.widget.width,
    sortOrder: plan.widget.sortOrder,
  };
}

function unavailableResult(plan: DashboardQueryPlan): DashboardWidgetResult {
  return {
    ...resultPresentation(plan),
    type: plan.widget.type,
    state: 'UNAVAILABLE',
    reason: 'QUERY_FAILED',
  };
}

async function lockDashboardDefinition(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<number | undefined> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('tenant_dashboard_configurations'),
      hashtext(${tenantId}::text)
    )
  `;
  const locked = await transaction.$queryRaw<Array<{ draftVersion: number }>>`
    SELECT version AS "draftVersion"
    FROM tenant_dashboard_configurations
    WHERE tenant_id = ${tenantId}::uuid
    FOR UPDATE
  `;
  return locked[0]?.draftVersion;
}

function definitionRecord(record: {
  draftVersion: number;
  draftConfiguration: Prisma.JsonValue;
  activePublicationId: string | null;
  sourceTemplateVersionId: string | null;
  updatedAt: Date;
}): DashboardDefinitionRecord {
  return {
    draftVersion: record.draftVersion,
    draftConfiguration: migrateLegacyDashboard(record.draftConfiguration),
    activePublicationId: record.activePublicationId,
    sourceTemplateVersionId: record.sourceTemplateVersionId,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function publicationRecord(record: {
  id: string;
  publicationNo: number;
  sourceDraftVersion: number;
  configuration: Prisma.JsonValue;
  publishedByMemberId: string | null;
  publishedAt: Date;
}): DashboardPublicationRecord {
  return {
    id: record.id,
    number: record.publicationNo,
    sourceDraftVersion: record.sourceDraftVersion,
    configuration: storedPublicationConfiguration(record.configuration),
    publishedByMemberId: record.publishedByMemberId,
    publishedAt: record.publishedAt.toISOString(),
  };
}

function storedPublicationConfiguration(
  value: Prisma.JsonValue,
): StoredDashboardPublicationConfiguration {
  const kind =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.schemaVersion === 2
      ? 'COMPILED_V2'
      : 'LEGACY';
  return { kind, raw: structuredClone(value) };
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
