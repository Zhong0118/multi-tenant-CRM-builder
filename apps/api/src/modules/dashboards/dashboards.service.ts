import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  compileDashboardPublication,
  normalizeDashboardDraft,
  parseDashboardDraft,
  validateDashboardDraft,
} from './dashboard-definition';
import { DashboardEngine } from './dashboard-engine';
import {
  DEFAULT_DASHBOARD_CODE,
  DEFAULT_DASHBOARD_NAME,
  isDashboardVisibleTo,
  nextDashboardCode,
  slugDashboardCode,
} from './dashboard-identity';
import type {
  DashboardAudience,
  DashboardDefinitionRecord,
  DashboardListItem,
  DashboardPublicationRecord,
  DashboardStatus,
} from './dashboards.repository';
import type {
  DashboardCatalog,
  DashboardConfigurationIssue,
  DashboardDefinitionV2,
  DashboardPeriod,
  DashboardRuntimeResult,
  PublishedDashboardDefinitionV2,
} from './dashboard.types';

export const DASHBOARDS_REPOSITORY = Symbol('DASHBOARDS_REPOSITORY');

export interface DashboardRepository {
  listDashboards(context: TenantContext): Promise<DashboardListItem[]>;
  getDefinition(
    context: TenantContext,
    dashboardCode: string,
  ): Promise<DashboardDefinitionRecord | null>;
  saveDraft(
    context: TenantContext,
    dashboardCode: string,
    expectedVersion: number,
    draft: DashboardDefinitionV2,
    audit: DashboardRequestMeta,
  ): Promise<DashboardDefinitionRecord | null>;
  publishDraft(
    context: TenantContext,
    dashboardCode: string,
    expectedVersion: number,
    compiled: PublishedDashboardDefinitionV2,
    actorMemberId: string,
    audit: DashboardRequestMeta,
  ): Promise<DashboardPublishOutcome>;
  getActivePublication(
    context: TenantContext,
    dashboardCode: string,
  ): Promise<DashboardPublicationRecord | null>;
  createDashboard(
    context: TenantContext,
    input: {
      code: string;
      name: string;
      audience: DashboardAudience;
      draft: DashboardDefinitionV2;
    },
    audit: DashboardRequestMeta,
  ): Promise<DashboardDefinitionRecord>;
  updateDashboard(
    context: TenantContext,
    dashboardCode: string,
    input: {
      name?: string;
      audience?: DashboardAudience;
      status?: DashboardStatus;
    },
    audit: DashboardRequestMeta,
  ): Promise<DashboardDefinitionRecord | null>;
  setDefaults(
    context: TenantContext,
    input: { adminDashboardCode?: string; employeeDashboardCode?: string },
    audit: DashboardRequestMeta,
  ): Promise<{
    adminDashboardCode: string | null;
    employeeDashboardCode: string | null;
  }>;
  getDefaults(context: TenantContext): Promise<{
    adminDashboardCode: string | null;
    employeeDashboardCode: string | null;
  }>;
  listPublishedObjects(context: TenantContext): Promise<DashboardCatalog>;
  getTenantTimezone(context: TenantContext): Promise<string | null>;
}

export type DashboardPublishOutcome =
  | { kind: 'PUBLISHED'; publication: DashboardPublicationRecord }
  | { kind: 'VERSION_CONFLICT' }
  | { kind: 'CATALOG_CHANGED' };

export interface DashboardRequestMeta {
  requestId: string;
  ip?: string;
}

export interface DashboardPublicationSummary {
  id: string;
  number: number;
  sourceDraftVersion: number;
  publishedAt: string;
}

export interface DashboardConfigurationEnvelope {
  timezone: string;
  dashboard: {
    id: string;
    code: string;
    name: string;
    status: DashboardStatus;
    audience: DashboardAudience;
    sortOrder: number;
  } | null;
  dashboards: DashboardListItem[];
  draft: DashboardDefinitionRecord | null;
  activePublication: DashboardPublicationSummary | null;
  candidates: DashboardCatalog;
  issues: DashboardConfigurationIssue[];
}

export type DashboardOverview =
  | ({
      state: 'UNCONFIGURED';
      role: TenantContext['role'];
      title: string;
      dashboardCode?: string;
      widgets: [];
    } & Pick<DashboardRuntimeResult, 'period'>)
  | ({
      state: 'READY';
      role: TenantContext['role'];
      dashboardCode: string;
      publication: DashboardPublicationSummary;
    } & DashboardRuntimeResult);

@Injectable()
export class DashboardsService {
  constructor(
    @Inject(DASHBOARDS_REPOSITORY)
    private readonly repository: DashboardRepository,
    private readonly engine: DashboardEngine,
  ) {}

  async list(context: TenantContext): Promise<DashboardListItem[]> {
    const dashboards = await this.repository.listDashboards(context);
    if (context.role === 'TENANT_ADMIN') return dashboards;
    return dashboards.filter(
      (dashboard) =>
        dashboard.status === 'ACTIVE' &&
        dashboard.hasPublishedVersion &&
        isDashboardVisibleTo(dashboard, context.role),
    );
  }

  async getConfiguration(
    context: TenantContext,
    dashboardCode = DEFAULT_DASHBOARD_CODE,
  ): Promise<DashboardConfigurationEnvelope> {
    assertAdministrator(context);
    const [timezone, dashboards, draft, activePublication, candidates] =
      await Promise.all([
        this.loadTenantTimezone(context),
        this.repository.listDashboards(context),
        this.repository.getDefinition(context, dashboardCode),
        this.repository.getActivePublication(context, dashboardCode),
        this.repository.listPublishedObjects(context),
      ]);
    return {
      timezone,
      dashboard:
        dashboards.find((item) => item.code === dashboardCode) ?? null,
      dashboards,
      draft,
      activePublication: activePublication
        ? publicationSummary(activePublication)
        : null,
      candidates,
      issues: draft
        ? validateDashboardDraft(draft.draftConfiguration, candidates)
        : [],
    };
  }

  async create(
    context: TenantContext,
    input: { name: string; audience?: DashboardAudience; copyFrom?: string },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord> {
    assertAdministrator(context);
    const name = input.name.trim();
    if (!name) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { name: ['请填写工作台名称。'] },
      });
    }
    const existing = await this.repository.listDashboards(context);
    const taken = new Set(existing.map((dashboard) => dashboard.code));
    const code = nextDashboardCode(slugDashboardCode(name), taken);
    const source = input.copyFrom
      ? await this.repository.getDefinition(context, input.copyFrom)
      : null;
    if (input.copyFrom && !source) {
      throw new ApiException('DASHBOARD_NOT_FOUND', 404);
    }
    const draft = source
      ? structuredClone(source.draftConfiguration)
      : emptyDashboard(name);
    draft.title = name;
    try {
      return await this.repository.createDashboard(
        context,
        {
          code,
          name,
          audience: input.audience ?? 'ALL',
          draft,
        },
        audit,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException('DASHBOARD_CODE_CONFLICT', 409);
      }
      throw error;
    }
  }

  async update(
    context: TenantContext,
    dashboardCode: string,
    input: {
      name?: string;
      audience?: DashboardAudience;
      status?: DashboardStatus;
    },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord> {
    assertAdministrator(context);
    const current = await this.requireDefinition(context, dashboardCode);
    if (input.status === 'ARCHIVED') {
      const dashboards = await this.repository.listDashboards(context);
      const stillActive = dashboards.filter(
        (dashboard) =>
          dashboard.status === 'ACTIVE' && dashboard.code !== dashboardCode,
      );
      if (
        (current.isDefaultAdmin || current.isDefaultEmployee) &&
        stillActive.length === 0
      ) {
        throw new ApiException('DASHBOARD_DEFAULT_REQUIRED', 409);
      }
    }
    const updated = await this.repository.updateDashboard(
      context,
      dashboardCode,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        audience: input.audience,
        status: input.status,
      },
      audit,
    );
    if (!updated) throw new ApiException('DASHBOARD_NOT_FOUND', 404);
    return updated;
  }

  async setDefaults(
    context: TenantContext,
    input: { adminDashboardCode?: string; employeeDashboardCode?: string },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ) {
    assertAdministrator(context);
    return this.repository.setDefaults(context, input, audit);
  }

  async saveDraft(
    context: TenantContext,
    dashboardCode: string,
    input: { expectedVersion: number; configuration: unknown },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord> {
    assertAdministrator(context);
    const draft = parseDraft(input.configuration);
    const saved = await this.repository.saveDraft(
      context,
      dashboardCode,
      input.expectedVersion,
      draft,
      audit,
    );
    if (!saved) {
      const current = await this.repository.getDefinition(
        context,
        dashboardCode,
      );
      throw versionConflict(current?.draftVersion);
    }
    return saved;
  }

  async preview(
    context: TenantContext,
    dashboardCode: string,
    input: {
      expectedVersion: number;
      period: { from: Date; to: Date };
    },
  ): Promise<DashboardRuntimeResult> {
    assertAdministrator(context);
    const [{ draft, catalog }, timezone] = await Promise.all([
      this.loadSavedDraft(context, dashboardCode, input.expectedVersion),
      this.loadTenantTimezone(context),
    ]);
    const publication = compileOrReject(draft, catalog);
    return this.engine.evaluate({
      publication,
      catalog,
      context,
      period: dashboardPeriod({ ...input.period, timezone }),
      preview: true,
    });
  }

  async publish(
    context: TenantContext,
    dashboardCode: string,
    input: { expectedVersion: number },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardPublicationSummary> {
    assertAdministrator(context);
    const { draft, catalog } = await this.loadSavedDraft(
      context,
      dashboardCode,
      input.expectedVersion,
    );
    const compiled = compileOrReject(draft, catalog);
    const outcome = await this.repository.publishDraft(
      context,
      dashboardCode,
      input.expectedVersion,
      compiled,
      context.memberId,
      audit,
    );
    if (outcome.kind === 'VERSION_CONFLICT') throw versionConflict();
    if (outcome.kind === 'CATALOG_CHANGED') {
      throw new ApiException('DASHBOARD_CATALOG_CHANGED', 409);
    }
    return publicationSummary(outcome.publication);
  }

  async getOverview(
    context: TenantContext,
    input: { from: Date; to: Date; dashboardCode?: string },
  ): Promise<DashboardOverview> {
    const [timezone, dashboards, defaults] = await Promise.all([
      this.loadTenantTimezone(context),
      this.repository.listDashboards(context),
      this.repository.getDefaults(context),
    ]);
    const period = dashboardPeriod({ ...input, timezone });
    const requested = input.dashboardCode;
    const fallback =
      context.role === 'TENANT_ADMIN'
        ? defaults.adminDashboardCode
        : defaults.employeeDashboardCode;
    const visible = dashboards.filter((dashboard) =>
      context.role === 'TENANT_ADMIN'
        ? dashboard.status === 'ACTIVE'
        : dashboard.status === 'ACTIVE' &&
          dashboard.hasPublishedVersion &&
          isDashboardVisibleTo(dashboard, context.role),
    );
    const selected =
      visible.find((dashboard) => dashboard.code === requested) ??
      visible.find((dashboard) => dashboard.code === fallback) ??
      visible[0];
    if (!selected) {
      return {
        state: 'UNCONFIGURED',
        role: context.role,
        title: DEFAULT_DASHBOARD_NAME,
        period,
        widgets: [],
      };
    }
    const publication = await this.repository.getActivePublication(
      context,
      selected.code,
    );
    if (!publication) {
      return {
        state: 'UNCONFIGURED',
        role: context.role,
        title: selected.name,
        dashboardCode: selected.code,
        period,
        widgets: [],
      };
    }
    const catalog = await this.repository.listPublishedObjects(context);
    const result = await this.engine.evaluate({
      publication: publication.configuration,
      catalog,
      context,
      period,
      preview: false,
    });
    return {
      state: 'READY',
      role: context.role,
      dashboardCode: selected.code,
      publication: publicationSummary(publication),
      ...result,
    };
  }

  private async loadSavedDraft(
    context: TenantContext,
    dashboardCode: string,
    expectedVersion: number,
  ) {
    const [definition, catalog] = await Promise.all([
      this.repository.getDefinition(context, dashboardCode),
      this.repository.listPublishedObjects(context),
    ]);
    if (!definition || definition.draftVersion !== expectedVersion) {
      throw versionConflict(definition?.draftVersion);
    }
    return { draft: definition.draftConfiguration, catalog };
  }

  private async requireDefinition(
    context: TenantContext,
    dashboardCode: string,
  ) {
    const [definition, dashboards] = await Promise.all([
      this.repository.getDefinition(context, dashboardCode),
      this.repository.listDashboards(context),
    ]);
    if (!definition) throw new ApiException('DASHBOARD_NOT_FOUND', 404);
    const listed = dashboards.find((item) => item.code === dashboardCode);
    return {
      ...definition,
      isDefaultAdmin: listed?.isDefaultAdmin ?? false,
      isDefaultEmployee: listed?.isDefaultEmployee ?? false,
    };
  }

  private async loadTenantTimezone(context: TenantContext): Promise<string> {
    const timezone = await this.repository.getTenantTimezone(context);
    if (!isValidTimeZone(timezone)) {
      throw new ApiException('INTERNAL_ERROR', 500, {
        message: '租户时区配置无效，请联系平台管理员。',
      });
    }
    return timezone;
  }
}

function assertAdministrator(context: TenantContext): void {
  if (context.role !== 'TENANT_ADMIN') {
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
  }
}

function parseDraft(value: unknown): DashboardDefinitionV2 {
  try {
    return normalizeDashboardDraft(parseDashboardDraft(value));
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { configuration: ['Invalid dashboard definition.'] },
    });
  }
}

function compileOrReject(
  draft: DashboardDefinitionV2,
  catalog: DashboardCatalog,
): PublishedDashboardDefinitionV2 {
  const issues = validateDashboardDraft(draft, catalog);
  if (issues.length > 0) {
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: issuesToFieldErrors(issues),
    });
  }
  return compileDashboardPublication(draft, catalog);
}

function issuesToFieldErrors(
  issues: DashboardConfigurationIssue[],
): Record<string, string[]> {
  return Object.fromEntries(
    issues.map((issue) => [issue.path, [issue.message]]),
  );
}

function emptyDashboard(title: string): DashboardDefinitionV2 {
  return { schemaVersion: 2, title, widgets: [] };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function versionConflict(currentVersion?: number): ApiException {
  return new ApiException('DASHBOARD_DRAFT_VERSION_CONFLICT', 409, {
    fieldErrors:
      currentVersion === undefined
        ? {}
        : { currentVersion: [String(currentVersion)] },
  });
}

function dashboardPeriod(input: {
  from: Date;
  to: Date;
  timezone: string;
}): DashboardPeriod {
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    timezone: input.timezone,
  };
}

function isValidTimeZone(value: string | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function publicationSummary(
  publication: DashboardPublicationRecord,
): DashboardPublicationSummary {
  return {
    id: publication.id,
    number: publication.number,
    sourceDraftVersion: publication.sourceDraftVersion,
    publishedAt: publication.publishedAt,
  };
}
