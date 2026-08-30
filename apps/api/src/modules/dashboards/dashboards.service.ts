import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { PublishedObjectService } from '../objects/published-object.service';
import {
  parseDashboardConfiguration,
  validateDashboardConfiguration,
} from './dashboard-configuration';
import type {
  DashboardAggregateInput,
  DashboardAggregateResult,
  DashboardConfiguration,
  DashboardConfigurationRecord,
  DashboardOverview,
  DashboardPeriod,
  DashboardPublishedObject,
} from './dashboard.types';

export const DASHBOARDS_REPOSITORY = Symbol('DASHBOARDS_REPOSITORY');

export interface DashboardRepository {
  getConfiguration(
    context: TenantContext,
  ): Promise<DashboardConfigurationRecord | null>;
  saveConfiguration(
    context: TenantContext,
    expectedVersion: number,
    configuration: DashboardConfiguration,
  ): Promise<DashboardConfigurationRecord | null>;
  listPublishedObjects(
    context: TenantContext,
  ): Promise<DashboardPublishedObject[]>;
  aggregateOverview(
    context: TenantContext,
    input: DashboardAggregateInput,
  ): Promise<DashboardAggregateResult>;
}

@Injectable()
export class DashboardsService {
  constructor(
    @Inject(DASHBOARDS_REPOSITORY)
    private readonly repository: DashboardRepository,
    private readonly publishedObjects: PublishedObjectService,
  ) {}

  async getConfiguration(context: TenantContext) {
    const [record, candidates] = await Promise.all([
      this.repository.getConfiguration(context),
      this.repository.listPublishedObjects(context),
    ]);
    const issues = record
      ? validateDashboardConfiguration(record.configuration, candidates)
      : [];
    return { record, candidates, issues };
  }

  async saveConfiguration(
    context: TenantContext,
    input: { expectedVersion: number; configuration: DashboardConfiguration },
  ) {
    if (context.role !== 'TENANT_ADMIN') {
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    }
    const configuration = parseDashboardConfiguration(input.configuration);
    const candidates = await this.repository.listPublishedObjects(context);
    const issues = validateDashboardConfiguration(configuration, candidates);
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: Object.fromEntries(
          issues.map((item) => [item.path, [item.message]]),
        ),
      });
    }
    const saved = await this.repository.saveConfiguration(
      context,
      input.expectedVersion,
      configuration,
    );
    if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
    return saved;
  }

  async getOverview(
    context: TenantContext,
    input: { from: Date; to: Date; timezone: string; ownerMemberId?: string },
  ): Promise<DashboardOverview> {
    const period: DashboardPeriod = {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      timezone: input.timezone,
    };
    const record = await this.repository.getConfiguration(context);
    if (!record) return emptyOverview('UNCONFIGURED', context, period);

    const candidates = await this.repository.listPublishedObjects(context);
    const issues = validateDashboardConfiguration(
      record.configuration,
      candidates,
    );
    const opportunity = candidates.find(
      (item) =>
        item.object.code === record.configuration.opportunity.objectCode,
    );
    if (issues.length > 0 || !opportunity) {
      return emptyOverview('NEEDS_REPAIR', context, period, issues);
    }

    let ownerMemberId = input.ownerMemberId;
    if (context.role === 'EMPLOYEE') {
      try {
        const resolved = await this.publishedObjects.resolveRuntimeSchema(
          context,
          opportunity.object.code,
        );
        if (resolved.access.readScope === 'OWN') {
          ownerMemberId = context.memberId;
        } else if (resolved.access.readScope === 'NONE') {
          return emptyOverview('UNAVAILABLE', context, period);
        }
        const requiredKeys = [
          record.configuration.opportunity.stageFieldKey,
          record.configuration.opportunity.amountFieldKey,
          record.configuration.opportunity.dateFieldKey,
        ].filter((key): key is string => Boolean(key));
        if (
          requiredKeys.some(
            (key) => resolved.access.fields[key] === 'HIDDEN',
          )
        ) {
          return emptyOverview('UNAVAILABLE', context, period);
        }
      } catch (error) {
        if (error instanceof ApiException && error.getStatus() < 500) {
          return emptyOverview('UNAVAILABLE', context, period);
        }
        throw error;
      }
    }

    const aggregate = await this.repository.aggregateOverview(context, {
      configuration: record.configuration,
      opportunity,
      period,
      ownerMemberId:
        context.role === 'TENANT_ADMIN' ? input.ownerMemberId : ownerMemberId,
      includeLeaderboard: context.role === 'TENANT_ADMIN',
    });
    return {
      state: 'READY',
      role: context.role,
      period,
      configuration: record.configuration,
      issues: [],
      ...aggregate,
    };
  }
}

function emptyOverview(
  state: DashboardOverview['state'],
  context: TenantContext,
  period: DashboardPeriod,
  issues: DashboardOverview['issues'] = [],
): DashboardOverview {
  return {
    state,
    role: context.role,
    period,
    issues,
    metrics: [],
    pipeline: [],
    trend: [],
    attention: [],
    leaderboard: [],
    records: [],
  };
}
