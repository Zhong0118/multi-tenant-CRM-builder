import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import {
  PublishedObjectService,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import type { PublishedObjectSchema } from '../objects/object-schema';
import {
  compileDashboardPublication,
  migrateLegacyDashboard,
} from './dashboard-definition';
import type {
  DashboardCatalog,
  DashboardPeriod,
  DashboardRuntimeResult,
  DashboardWidgetResult,
  DashboardWidgetUnavailableReason,
  PublishedDashboardDefinitionV2,
  PublishedDashboardWidgetV2,
  StoredDashboardPublicationConfiguration,
} from './dashboard.types';

export type { DashboardWidgetResult } from './dashboard.types';

export const DASHBOARD_QUERY_EXECUTOR = Symbol('DASHBOARD_QUERY_EXECUTOR');

export interface DashboardAccessResolver {
  resolveRuntimeSchema(
    context: TenantContext,
    objectCode: string,
  ): Promise<ResolvedObjectSchema>;
}

export interface DashboardQueryPlan {
  widget: PublishedDashboardWidgetV2;
  object: PublishedObjectSchema;
  period: DashboardPeriod;
  ownerMemberId?: string;
  visibleFieldKeys: string[];
}

export interface DashboardQueryExecutor {
  execute(
    context: TenantContext,
    plans: DashboardQueryPlan[],
  ): Promise<Map<string, DashboardWidgetResult>>;
}

export interface DashboardEvaluationInput {
  publication:
    PublishedDashboardDefinitionV2 | StoredDashboardPublicationConfiguration;
  catalog: DashboardCatalog;
  context: TenantContext;
  period: DashboardPeriod;
  preview?: boolean;
}

@Injectable()
export class DashboardEngine {
  constructor(
    @Inject(PublishedObjectService)
    private readonly accessResolver: DashboardAccessResolver,
    @Inject(DASHBOARD_QUERY_EXECUTOR)
    private readonly executor: DashboardQueryExecutor,
  ) {}

  async evaluate(
    input: DashboardEvaluationInput,
  ): Promise<DashboardRuntimeResult> {
    const publication = normalizePublication(input.publication, input.catalog);
    const audienceWidgets = publication.widgets.filter((widget) =>
      matchesAudience(widget, input.context),
    );
    const accessByCode = await resolveAccessOnce(
      this.accessResolver,
      input.context,
      audienceWidgets,
    );
    const plans: DashboardQueryPlan[] = [];
    const omissions = new Map<string, DashboardWidgetUnavailableReason>();

    for (const widget of publication.widgets) {
      if (!matchesAudience(widget, input.context)) {
        omissions.set(widget.id, 'AUDIENCE_EXCLUDED');
        continue;
      }
      const resolved = accessByCode.get(widget.objectCode);
      if (!resolved) {
        omissions.set(widget.id, 'OBJECT_UNAVAILABLE');
        continue;
      }
      if (!resolved.access.canRead || resolved.access.readScope === 'NONE') {
        omissions.set(widget.id, 'OBJECT_ACCESS_DENIED');
        continue;
      }
      const ownerMemberId =
        input.context.role === 'EMPLOYEE' && resolved.access.readScope === 'OWN'
          ? input.context.memberId
          : undefined;
      const plannedWidget = ownerMemberId
        ? collapseOwnLeaderboard(widget)
        : widget;
      const projection = projectFields(plannedWidget, resolved.access);
      if (!projection) {
        omissions.set(widget.id, 'FIELD_HIDDEN');
        continue;
      }
      plans.push({
        widget: plannedWidget,
        object: resolved.schema,
        period: input.period,
        ownerMemberId,
        visibleFieldKeys: projection,
      });
    }

    let executed: Map<string, DashboardWidgetResult>;
    try {
      executed = await this.executor.execute(input.context, plans);
    } catch {
      executed = new Map();
    }

    const diagnostics =
      input.preview === true && input.context.role === 'TENANT_ADMIN';
    const planned = new Set(plans.map((plan) => plan.widget.id));
    const widgets = publication.widgets.flatMap((widget) => {
      const omission = omissions.get(widget.id);
      if (omission) {
        return diagnostics ? [unavailable(widget, omission, true)] : [];
      }
      if (!planned.has(widget.id)) return [];
      const result = executed.get(widget.id);
      if (!result) return [unavailable(widget, 'QUERY_FAILED', diagnostics)];
      if (result.state === 'UNAVAILABLE') {
        return [
          diagnostics
            ? { ...result, reason: result.reason ?? 'QUERY_FAILED' }
            : withoutReason(result),
        ];
      }
      return [result];
    });

    return { title: publication.title, period: input.period, widgets };
  }
}

function collapseOwnLeaderboard(
  widget: PublishedDashboardWidgetV2,
): PublishedDashboardWidgetV2 {
  if (widget.type !== 'LEADERBOARD' || widget.memberSource !== 'FIELD') {
    return widget;
  }
  const ownerLeaderboard = { ...widget, memberSource: 'RECORD_OWNER' as const };
  delete ownerLeaderboard.memberFieldKey;
  delete ownerLeaderboard.memberField;
  return ownerLeaderboard;
}

function normalizePublication(
  value:
    PublishedDashboardDefinitionV2 | StoredDashboardPublicationConfiguration,
  catalog: DashboardCatalog,
): PublishedDashboardDefinitionV2 {
  if (isStoredPublication(value)) {
    if (value.kind === 'LEGACY') {
      return compileDashboardPublication(
        migrateLegacyDashboard(value.raw),
        catalog,
      );
    }
    return publishedDefinition(value.raw);
  }
  return publishedDefinition(value);
}

function isStoredPublication(
  value:
    PublishedDashboardDefinitionV2 | StoredDashboardPublicationConfiguration,
): value is StoredDashboardPublicationConfiguration {
  return 'kind' in value;
}

function publishedDefinition(value: unknown): PublishedDashboardDefinitionV2 {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 2 ||
    typeof (value as Record<string, unknown>).title !== 'string' ||
    !Array.isArray((value as Record<string, unknown>).widgets)
  ) {
    throw new Error('Invalid compiled dashboard publication');
  }
  const publication = structuredClone(value) as PublishedDashboardDefinitionV2;
  if (
    publication.widgets.some(
      (widget) =>
        widget === null ||
        typeof widget !== 'object' ||
        typeof widget.id !== 'string' ||
        typeof widget.objectCode !== 'string' ||
        typeof widget.objectPublicationId !== 'string' ||
        !Number.isInteger(widget.objectPublicationNumber),
    )
  ) {
    throw new Error('Invalid compiled dashboard publication');
  }
  return publication;
}

async function resolveAccessOnce(
  resolver: DashboardAccessResolver,
  context: TenantContext,
  widgets: PublishedDashboardWidgetV2[],
) {
  const objectCodes = [...new Set(widgets.map((widget) => widget.objectCode))];
  const entries = await Promise.all(
    objectCodes.map(async (objectCode) => {
      try {
        return [
          objectCode,
          await resolver.resolveRuntimeSchema(context, objectCode),
        ] as const;
      } catch {
        return [objectCode, null] as const;
      }
    }),
  );
  return new Map(entries);
}

function matchesAudience(
  widget: PublishedDashboardWidgetV2,
  context: TenantContext,
) {
  return widget.audience === 'ALL' || widget.audience === context.role;
}

function projectFields(
  widget: PublishedDashboardWidgetV2,
  access: EffectiveObjectAccess,
): string[] | null {
  const required = requiredFieldKeys(widget);
  if (required.some((fieldKey) => !isFieldVisible(access, fieldKey))) {
    return null;
  }
  if (widget.type !== 'RECORD_LIST') return [];
  const visible = widget.fieldKeys.filter((fieldKey) =>
    isFieldVisible(access, fieldKey),
  );
  return visible.length > 0 ? visible : null;
}

function isFieldVisible(access: EffectiveObjectAccess, fieldKey: string) {
  const fieldAccess = access.fields[fieldKey];
  return fieldAccess !== undefined && fieldAccess !== 'HIDDEN';
}

function requiredFieldKeys(widget: PublishedDashboardWidgetV2): string[] {
  const keys = widget.filters.map((filter) => filter.fieldKey);
  switch (widget.type) {
    case 'METRIC':
      if (widget.aggregation !== 'COUNT' && widget.valueFieldKey) {
        keys.push(widget.valueFieldKey);
      }
      break;
    case 'STATUS_DISTRIBUTION':
      keys.push(widget.groupByFieldKey);
      if (widget.aggregation === 'SUM' && widget.valueFieldKey) {
        keys.push(widget.valueFieldKey);
      }
      break;
    case 'TREND':
      keys.push(widget.dateFieldKey);
      if (widget.aggregation === 'SUM' && widget.valueFieldKey) {
        keys.push(widget.valueFieldKey);
      }
      break;
    case 'LEADERBOARD':
      if (widget.memberSource === 'FIELD' && widget.memberFieldKey) {
        keys.push(widget.memberFieldKey);
      }
      if (widget.aggregation === 'SUM' && widget.valueFieldKey) {
        keys.push(widget.valueFieldKey);
      }
      break;
    case 'RECORD_LIST':
      if (!isSystemField(widget.sort.field)) keys.push(widget.sort.field);
      break;
  }
  return [...new Set(keys)];
}

function isSystemField(fieldKey: string) {
  return ['createdAt', 'updatedAt', 'recordNo'].includes(fieldKey);
}

function unavailable(
  widget: PublishedDashboardWidgetV2,
  reason: DashboardWidgetUnavailableReason,
  includeReason: boolean,
): DashboardWidgetResult {
  return {
    ...presentation(widget),
    state: 'UNAVAILABLE',
    ...(includeReason ? { reason } : {}),
  };
}

function presentation(widget: PublishedDashboardWidgetV2) {
  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    objectCode: widget.objectCode,
    ...(widget.description === undefined
      ? {}
      : { description: widget.description }),
    width: widget.width,
    sortOrder: widget.sortOrder,
  };
}

function withoutReason(
  result: Extract<DashboardWidgetResult, { state: 'UNAVAILABLE' }>,
): DashboardWidgetResult {
  const safe = { ...result };
  delete safe.reason;
  return safe;
}
