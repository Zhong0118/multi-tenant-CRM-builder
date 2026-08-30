import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { DashboardConfiguration } from './dashboard.types';
import {
  DashboardConfigurationEnvelopeDto,
  DashboardConfigurationRecordDto,
  DashboardOverviewDto,
  DashboardOverviewQueryDto,
  SaveDashboardConfigurationDto,
} from './dto';
import { DashboardsService } from './dashboards.service';

@Controller('workspaces/:tenantCode/dashboard')
@ApiTags('dashboards')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('configuration')
  @ApiOkResponse({ type: DashboardConfigurationEnvelopeDto })
  configuration(@CurrentTenant() context: TenantContext) {
    return this.dashboards.getConfiguration(context);
  }

  @Put('configuration')
  @ApiOkResponse({ type: DashboardConfigurationRecordDto })
  saveConfiguration(
    @CurrentTenant() context: TenantContext,
    @Body() dto: SaveDashboardConfigurationDto,
  ) {
    return this.dashboards.saveConfiguration(context, {
      expectedVersion: dto.expectedVersion,
      configuration: dto.configuration as DashboardConfiguration,
    });
  }

  @Get('overview')
  @ApiOkResponse({ type: DashboardOverviewDto })
  overview(
    @CurrentTenant() context: TenantContext,
    @Query() query: DashboardOverviewQueryDto,
  ) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - (query.days ?? 31) * 24 * 60 * 60 * 1000);
    if (
      from >= to ||
      to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { from: ['统计区间必须为 1 至 366 天。'] },
      });
    }
    return this.dashboards.getOverview(context, {
      from,
      to,
      timezone: 'Asia/Shanghai',
      ownerMemberId: query.ownerMemberId,
    });
  }
}
