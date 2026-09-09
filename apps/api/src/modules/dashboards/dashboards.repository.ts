import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { parsePublishedObjectSchema } from '../objects/published-object.service';
import { DEFAULT_DASHBOARD_NAME } from './dashboard-identity';
import { migrateLegacyDashboard } from './dashboard-definition';
import type {
  DashboardQueryExecutor,
  DashboardQueryPlan,
} from './dashboard-engine';
import type {
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
import type {
  DashboardPublishOutcome,
  DashboardRepository,
  DashboardRequestMeta,
} from './dashboards.service';

export type { StoredDashboardPublicationConfiguration } from './dashboard.types';

export type DashboardStatus = 'ACTIVE' | 'ARCHIVED';
export type DashboardAudience = 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';

export interface DashboardDefinitionRecord {
  id: string;
  code: string;
  name: string;
  status: DashboardStatus;
  audience: DashboardAudience;
  sortOrder: number;
  draftVersion: number;
  draftConfiguration: DashboardDefinitionV2;
  activePublicationId: string | null;
  sourceTemplateVersionId: string | null;
  updatedAt: string;
}

export interface DashboardListItem {
  id: string;
  code: string;
  name: string;
  status: DashboardStatus;
  audience: DashboardAudience;
  sortOrder: number;
  hasPublishedVersion: boolean;
  isDefaultAdmin: boolean;
  isDefaultEmployee: boolean;
}

export interface DashboardDefaults {
  adminDashboardCode: string | null;
  employeeDashboardCode: string | null;
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
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  listDashboards(context: TenantContext): Promise<DashboardListItem[]> {
    return this.runner.withTenant(context, async (transaction) => {
      const [records, tenant] = await Promise.all([
        transaction.tenantDashboardConfiguration.findMany({
          where: { tenantId: context.tenantId },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        }),
        transaction.tenant.findUnique({
          where: { id: context.tenantId },
          select: {
            defaultAdminDashboardId: true,
            defaultEmployeeDashboardId: true,
          },
        }),
      ]);
      return records.map((record) => ({
        id: record.id,
        code: record.code,
        name: record.name,
        status: record.status,
        audience: record.audience,
        sortOrder: record.sortOrder,
        hasPublishedVersion: record.activePublicationId !== null,
        isDefaultAdmin: tenant?.defaultAdminDashboardId === record.id,
        isDefaultEmployee: tenant?.defaultEmployeeDashboardId === record.id,
      }));
    });
  }

  getDefinition(
    context: TenantContext,
    dashboardCode: string,
  ): Promise<DashboardDefinitionRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const record = await transaction.tenantDashboardConfiguration.findUnique({
        where: {
          tenantId_code: { tenantId: context.tenantId, code: dashboardCode },
        },
      });
      return record ? definitionRecord(record) : null;
    });
  }

  saveDraft(
    context: TenantContext,
    dashboardCode: string,
    expectedVersion: number,
    draft: DashboardDefinitionV2,
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const locked = await lockDashboardDefinition(
        transaction,
        context.tenantId,
        dashboardCode,
      );
      if (
        (locked === undefined && expectedVersion !== 0) ||
        (locked !== undefined && locked.draftVersion !== expectedVersion)
      ) {
        return null;
      }

      const draftConfiguration = draft as unknown as Prisma.InputJsonValue;
      const record =
        locked === undefined
          ? await createDashboardRow(transaction, {
              tenantId: context.tenantId,
              code: dashboardCode,
              name: draft.title.trim() || DEFAULT_DASHBOARD_NAME,
              draftConfiguration,
            })
          : await transaction.tenantDashboardConfiguration.update({
              where: { id: locked.id },
              data: {
                draftVersion: { increment: 1 },
                draftConfiguration,
              },
            });
      await this.appendAudit(transaction, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'dashboard.draft_saved',
        resourceType: 'dashboard_definition',
        resourceId: record.id,
        after: {
          dashboardCode: record.code,
          draftVersion: record.draftVersion,
          widgetCount: draft.widgets.length,
        },
        requestId: audit.requestId,
        ip: audit.ip,
      });
      return definitionRecord(record);
    });
  }

  publishDraft(
    context: TenantContext,
    dashboardCode: string,
    expectedVersion: number,
    compiled: PublishedDashboardDefinitionV2,
    actorMemberId: string,
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardPublishOutcome> {
    return this.runner.withTenant(context, async (transaction) => {
      const locked = await lockDashboardDefinition(
        transaction,
        context.tenantId,
        dashboardCode,
      );
      if (!locked || locked.draftVersion !== expectedVersion) {
        return { kind: 'VERSION_CONFLICT' };
      }
      if (!(await lockCurrentObjectBindings(transaction, context, compiled))) {
        return { kind: 'CATALOG_CHANGED' };
      }

      const numbers = await transaction.$queryRaw<Array<{ number: number }>>`
        SELECT COALESCE(MAX(publication_no), 0)::int + 1 AS number
        FROM tenant_dashboard_publications
        WHERE dashboard_id = ${locked.id}::uuid
      `;
      const publication = await transaction.tenantDashboardPublication.create({
        data: {
          tenantId: context.tenantId,
          dashboardId: locked.id,
          publicationNo: numbers[0]?.number ?? 1,
          sourceDraftVersion: expectedVersion,
          configuration: compiled as unknown as Prisma.InputJsonValue,
          publishedByMemberId: actorMemberId,
        },
      });
      await transaction.tenantDashboardConfiguration.update({
        where: { id: locked.id },
        data: { activePublicationId: publication.id },
      });
      await this.appendAudit(transaction, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'dashboard.published',
        resourceType: 'dashboard_publication',
        resourceId: publication.id,
        after: {
          dashboardCode,
          draftVersion: expectedVersion,
          publicationNumber: publication.publicationNo,
          widgetCount: compiled.widgets.length,
        },
        requestId: audit.requestId,
        ip: audit.ip,
      });
      return {
        kind: 'PUBLISHED',
        publication: publicationRecord(publication),
      };
    });
  }

  private appendAudit(
    transaction: Prisma.TransactionClient,
    event: Parameters<AuditService['append']>[1],
  ): Promise<void> {
    return this.audit.append(transaction, event);
  }

  getActivePublication(
    context: TenantContext,
    dashboardCode: string,
  ): Promise<DashboardPublicationRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const definition =
        await transaction.tenantDashboardConfiguration.findUnique({
          where: {
            tenantId_code: { tenantId: context.tenantId, code: dashboardCode },
          },
          select: { activePublication: true, status: true, audience: true },
        });
      return definition?.activePublication
        ? publicationRecord(definition.activePublication)
        : null;
    });
  }

  async createDashboard(
    context: TenantContext,
    input: {
      code: string;
      name: string;
      audience: DashboardAudience;
      draft: DashboardDefinitionV2;
    },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord> {
    return this.runner.withTenant(context, async (transaction) => {
      const created = await createDashboardRow(transaction, {
        tenantId: context.tenantId,
        code: input.code,
        name: input.name,
        audience: input.audience,
        draftConfiguration: input.draft as unknown as Prisma.InputJsonValue,
      });
      await this.appendAudit(transaction, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'dashboard.created',
        resourceType: 'dashboard_definition',
        resourceId: created.id,
        after: { dashboardCode: created.code, name: created.name },
        requestId: audit.requestId,
        ip: audit.ip,
      });
      return definitionRecord(created);
    });
  }

  async updateDashboard(
    context: TenantContext,
    dashboardCode: string,
    input: {
      name?: string;
      audience?: DashboardAudience;
      status?: DashboardStatus;
    },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const current = await transaction.tenantDashboardConfiguration.findUnique(
        {
          where: {
            tenantId_code: { tenantId: context.tenantId, code: dashboardCode },
          },
        },
      );
      if (!current) return null;
      const updated = await transaction.tenantDashboardConfiguration.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.appendAudit(transaction, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'dashboard.updated',
        resourceType: 'dashboard_definition',
        resourceId: updated.id,
        after: {
          dashboardCode: updated.code,
          name: updated.name,
          audience: updated.audience,
          status: updated.status,
        },
        requestId: audit.requestId,
        ip: audit.ip,
      });
      return definitionRecord(updated);
    });
  }

  async reorderDashboards(
    context: TenantContext,
    dashboardCodes: string[],
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardListItem[]> {
    return this.runner
      .withTenant(context, async (transaction) => {
        for (const [index, code] of dashboardCodes.entries()) {
          await transaction.tenantDashboardConfiguration.update({
            where: {
              tenantId_code: { tenantId: context.tenantId, code },
            },
            data: { sortOrder: (index + 1) * 10 },
          });
        }
        await this.appendAudit(transaction, {
          tenantId: context.tenantId,
          actorType: 'USER',
          actorId: context.userId,
          action: 'dashboard.order_updated',
          resourceType: 'dashboard_definition',
          resourceId: context.tenantId,
          after: { dashboardCodes },
          requestId: audit.requestId,
          ip: audit.ip,
        });
      })
      .then(() => this.listDashboards(context));
  }

  async setDefaults(
    context: TenantContext,
    input: { adminDashboardCode?: string; employeeDashboardCode?: string },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefaults> {
    return this.runner.withTenant(context, async (transaction) => {
      const records = await transaction.tenantDashboardConfiguration.findMany({
        where: { tenantId: context.tenantId, status: 'ACTIVE' },
      });
      const byCode = new Map(records.map((record) => [record.code, record]));
      const admin = input.adminDashboardCode
        ? byCode.get(input.adminDashboardCode)
        : undefined;
      const employee = input.employeeDashboardCode
        ? byCode.get(input.employeeDashboardCode)
        : undefined;
      const tenant = await transaction.tenant.update({
        where: { id: context.tenantId },
        data: {
          ...(admin ? { defaultAdminDashboardId: admin.id } : {}),
          ...(employee ? { defaultEmployeeDashboardId: employee.id } : {}),
        },
        select: {
          defaultAdminDashboard: { select: { code: true } },
          defaultEmployeeDashboard: { select: { code: true } },
        },
      });
      await this.appendAudit(transaction, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'dashboard.defaults_updated',
        resourceType: 'dashboard_definition',
        resourceId: context.tenantId,
        after: {
          adminDashboardCode: tenant.defaultAdminDashboard?.code ?? null,
          employeeDashboardCode: tenant.defaultEmployeeDashboard?.code ?? null,
        },
        requestId: audit.requestId,
        ip: audit.ip,
      });
      return {
        adminDashboardCode: tenant.defaultAdminDashboard?.code ?? null,
        employeeDashboardCode: tenant.defaultEmployeeDashboard?.code ?? null,
      };
    });
  }

  getDefaults(context: TenantContext): Promise<DashboardDefaults> {
    return this.runner.withTenant(context, async (transaction) => {
      const tenant = await transaction.tenant.findUnique({
        where: { id: context.tenantId },
        select: {
          defaultAdminDashboard: { select: { code: true } },
          defaultEmployeeDashboard: { select: { code: true } },
        },
      });
      return {
        adminDashboardCode: tenant?.defaultAdminDashboard?.code ?? null,
        employeeDashboardCode: tenant?.defaultEmployeeDashboard?.code ?? null,
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

  getTenantTimezone(context: TenantContext): Promise<string | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const tenant = await transaction.tenant.findUnique({
        where: { id: context.tenantId },
        select: { timezone: true },
      });
      return tenant?.timezone ?? null;
    });
  }
}

async function lockCurrentObjectBindings(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  compiled: PublishedDashboardDefinitionV2,
): Promise<boolean> {
  const bindings = new Map<string, string>();
  for (const widget of compiled.widgets) {
    const current = bindings.get(widget.objectCode);
    if (current && current !== widget.objectPublicationId) return false;
    bindings.set(widget.objectCode, widget.objectPublicationId);
  }
  if (bindings.size === 0) return true;

  const locked = await transaction.$queryRaw<
    Array<{
      code: string;
      status: string;
      activePublicationId: string | null;
    }>
  >(Prisma.sql`
    SELECT
      code,
      status::text AS status,
      active_publication_id::text AS "activePublicationId"
    FROM object_definitions
    WHERE tenant_id = ${context.tenantId}::uuid
      AND code IN (${Prisma.join([...bindings.keys()])})
    FOR SHARE
  `);
  if (locked.length !== bindings.size) return false;
  return locked.every(
    (object) =>
      object.status === 'ACTIVE' &&
      object.activePublicationId === bindings.get(object.code),
  );
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
  const title = plan.canReadTitle
    ? Prisma.sql`r.title`
    : Prisma.sql`r.record_no::text`;
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
      ${title} AS title,
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
      fields: (plan.widget.displayFields ?? [])
        .filter((field) => visible.has(field.fieldKey))
        .map((field) => {
          const published = plan.object.fields.find(
            (item) => item.fieldKey === field.fieldKey,
          );
          return {
            ...field,
            config: published?.config ?? {},
            validation: published?.validation ?? {},
          };
        }),
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
  const value = Prisma.sql`r.data ->> ${fieldKey}`;
  const date = type === 'DATE' ? value : Prisma.sql`left(${value}, 10)`;
  const calendarDate = Prisma.sql`
    CASE
      WHEN ${date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        THEN CASE
          WHEN substring(${date} FROM 1 FOR 4)::integer BETWEEN 1 AND 9999
            AND substring(${date} FROM 6 FOR 2)::integer BETWEEN 1 AND 12
            AND substring(${date} FROM 9 FOR 2)::integer BETWEEN 1 AND 31
            THEN CASE
              WHEN to_char(
                make_date(
                  substring(${date} FROM 1 FOR 4)::integer,
                  substring(${date} FROM 6 FOR 2)::integer,
                  1
                ) + (substring(${date} FROM 9 FOR 2)::integer - 1),
                'YYYY-MM-DD'
              ) = ${date}
                THEN (${date})::date
              ELSE NULL
            END
          ELSE NULL
        END
      ELSE NULL
    END
  `;
  if (type === 'DATE') return calendarDate;
  return Prisma.sql`
    CASE
      WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
        THEN CASE
          WHEN ${calendarDate} IS NOT NULL
            AND substring(${value} FROM 12 FOR 2)::integer BETWEEN 0 AND 23
            AND substring(${value} FROM 15 FOR 2)::integer BETWEEN 0 AND 59
            AND substring(${value} FROM 18 FOR 2)::integer BETWEEN 0 AND 59
            THEN (${value})::timestamptz
          ELSE NULL
        END
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
    objectCode: plan.widget.objectCode,
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
  dashboardCode: string,
): Promise<{ id: string; draftVersion: number } | undefined> {
  await transaction.$queryRaw`
    SELECT (
      pg_advisory_xact_lock(
        hashtext('tenant_dashboard_configurations'),
        hashtext(${`${tenantId}:${dashboardCode}`}::text)
      ) IS NULL
    ) AS "acquired"
  `;
  const locked = await transaction.$queryRaw<
    Array<{ id: string; draftVersion: number }>
  >`
    SELECT id, version AS "draftVersion"
    FROM tenant_dashboard_configurations
    WHERE tenant_id = ${tenantId}::uuid
      AND code = ${dashboardCode}
    FOR UPDATE
  `;
  return locked[0];
}

async function createDashboardRow(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    code: string;
    name: string;
    audience?: DashboardAudience;
    draftConfiguration: Prisma.InputJsonValue;
  },
) {
  const last = await transaction.tenantDashboardConfiguration.aggregate({
    where: { tenantId: input.tenantId },
    _max: { sortOrder: true },
  });
  const created = await transaction.tenantDashboardConfiguration.create({
    data: {
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      audience: input.audience ?? 'ALL',
      sortOrder: (last._max.sortOrder ?? -1) + 10,
      draftVersion: 1,
      draftConfiguration: input.draftConfiguration,
    },
  });
  const tenant = await transaction.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      defaultAdminDashboardId: true,
      defaultEmployeeDashboardId: true,
    },
  });
  if (!tenant?.defaultAdminDashboardId || !tenant.defaultEmployeeDashboardId) {
    await transaction.tenant.update({
      where: { id: input.tenantId },
      data: {
        ...(tenant?.defaultAdminDashboardId
          ? {}
          : { defaultAdminDashboardId: created.id }),
        ...(tenant?.defaultEmployeeDashboardId
          ? {}
          : { defaultEmployeeDashboardId: created.id }),
      },
    });
  }
  return created;
}

function definitionRecord(record: {
  id: string;
  code: string;
  name: string;
  status: DashboardStatus;
  audience: DashboardAudience;
  sortOrder: number;
  draftVersion: number;
  draftConfiguration: Prisma.JsonValue;
  activePublicationId: string | null;
  sourceTemplateVersionId: string | null;
  updatedAt: Date;
}): DashboardDefinitionRecord {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    status: record.status,
    audience: record.audience,
    sortOrder: record.sortOrder,
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
