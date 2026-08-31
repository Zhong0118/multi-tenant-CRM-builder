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
import type {
  DashboardDefinitionRecord,
  DashboardPublicationRecord,
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
  getDefinition(
    context: TenantContext,
  ): Promise<DashboardDefinitionRecord | null>;
  saveDraft(
    context: TenantContext,
    expectedVersion: number,
    draft: DashboardDefinitionV2,
    audit: DashboardRequestMeta,
  ): Promise<DashboardDefinitionRecord | null>;
  publishDraft(
    context: TenantContext,
    expectedVersion: number,
    compiled: PublishedDashboardDefinitionV2,
    actorMemberId: string,
    audit: DashboardRequestMeta,
  ): Promise<DashboardPublicationRecord | null>;
  getActivePublication(
    context: TenantContext,
  ): Promise<DashboardPublicationRecord | null>;
  listPublishedObjects(context: TenantContext): Promise<DashboardCatalog>;
}

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
  draft: DashboardDefinitionRecord | null;
  activePublication: DashboardPublicationSummary | null;
  candidates: DashboardCatalog;
  issues: DashboardConfigurationIssue[];
}

export type DashboardOverview =
  | ({
      state: 'UNCONFIGURED';
      role: TenantContext['role'];
      title: '工作台';
      widgets: [];
    } & Pick<DashboardRuntimeResult, 'period'>)
  | ({
      state: 'READY';
      role: TenantContext['role'];
      publication: DashboardPublicationSummary;
    } & DashboardRuntimeResult);

@Injectable()
export class DashboardsService {
  constructor(
    @Inject(DASHBOARDS_REPOSITORY)
    private readonly repository: DashboardRepository,
    private readonly engine: DashboardEngine,
  ) {}

  async getConfiguration(
    context: TenantContext,
  ): Promise<DashboardConfigurationEnvelope> {
    assertAdministrator(context);
    const [draft, activePublication, candidates] = await Promise.all([
      this.repository.getDefinition(context),
      this.repository.getActivePublication(context),
      this.repository.listPublishedObjects(context),
    ]);
    return {
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

  async saveDraft(
    context: TenantContext,
    input: { expectedVersion: number; configuration: unknown },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardDefinitionRecord> {
    assertAdministrator(context);
    const draft = parseDraft(input.configuration);
    const saved = await this.repository.saveDraft(
      context,
      input.expectedVersion,
      draft,
      audit,
    );
    if (!saved) throw versionConflict();
    return saved;
  }

  async preview(
    context: TenantContext,
    input: {
      expectedVersion: number;
      period: { from: Date; to: Date; timezone: string };
    },
  ): Promise<DashboardRuntimeResult> {
    assertAdministrator(context);
    const { draft, catalog } = await this.loadSavedDraft(
      context,
      input.expectedVersion,
    );
    const publication = compileOrReject(draft, catalog);
    return this.engine.evaluate({
      publication,
      catalog,
      context,
      period: dashboardPeriod(input.period),
      preview: true,
    });
  }

  async publish(
    context: TenantContext,
    input: { expectedVersion: number },
    audit: DashboardRequestMeta = { requestId: 'req_unknown' },
  ): Promise<DashboardPublicationSummary> {
    assertAdministrator(context);
    const { draft, catalog } = await this.loadSavedDraft(
      context,
      input.expectedVersion,
    );
    const compiled = compileOrReject(draft, catalog);
    const publication = await this.repository.publishDraft(
      context,
      input.expectedVersion,
      compiled,
      context.memberId,
      audit,
    );
    if (!publication) throw versionConflict();
    return publicationSummary(publication);
  }

  async getOverview(
    context: TenantContext,
    input: { from: Date; to: Date; timezone: string },
  ): Promise<DashboardOverview> {
    const period = dashboardPeriod(input);
    const publication = await this.repository.getActivePublication(context);
    if (!publication) {
      return {
        state: 'UNCONFIGURED',
        role: context.role,
        title: '工作台',
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
      publication: publicationSummary(publication),
      ...result,
    };
  }

  private async loadSavedDraft(
    context: TenantContext,
    expectedVersion: number,
  ) {
    const [definition, catalog] = await Promise.all([
      this.repository.getDefinition(context),
      this.repository.listPublishedObjects(context),
    ]);
    if (!definition || definition.draftVersion !== expectedVersion) {
      throw versionConflict();
    }
    return { draft: definition.draftConfiguration, catalog };
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

function versionConflict(): ApiException {
  return new ApiException('DASHBOARD_DRAFT_VERSION_CONFLICT', 409);
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
