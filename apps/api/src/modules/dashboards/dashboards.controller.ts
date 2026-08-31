import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  DashboardConfigurationEnvelopeDto,
  DashboardDraftDto,
  DashboardOverviewDto,
  DashboardOverviewQueryDto,
  DashboardPeriodDto,
  DashboardPublicationSummaryDto,
  DashboardRuntimeDto,
  PreviewDashboardDto,
  PublishDashboardDto,
  SaveDashboardConfigurationDto,
} from './dto';
import { DashboardsService } from './dashboards.service';

@Controller('workspaces/:tenantCode/dashboard')
@ApiTags('dashboards')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiExtraModels(DashboardRuntimeDto)
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('configuration')
  @ApiOkResponse({ type: DashboardConfigurationEnvelopeDto })
  configuration(@CurrentTenant() context: TenantContext) {
    return this.dashboards.getConfiguration(context);
  }

  @Put('configuration')
  @ApiOkResponse({ type: DashboardDraftDto })
  saveConfiguration(
    @CurrentTenant() context: TenantContext,
    @Body() dto: SaveDashboardConfigurationDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.saveDraft(
      context,
      {
        expectedVersion: dto.expectedVersion,
        configuration: dto.configuration,
      },
      requestMeta(request),
    );
  }

  @Post('preview')
  @ApiOkResponse({ type: DashboardRuntimeDto })
  preview(
    @CurrentTenant() context: TenantContext,
    @Body() dto: PreviewDashboardDto,
  ) {
    return this.dashboards.preview(context, {
      expectedVersion: dto.expectedVersion,
      period: periodFrom(dto.period),
    });
  }

  @Post('publications')
  @ApiOkResponse({ type: DashboardPublicationSummaryDto })
  publish(
    @CurrentTenant() context: TenantContext,
    @Body() dto: PublishDashboardDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.publish(
      context,
      { expectedVersion: dto.expectedVersion },
      requestMeta(request),
    );
  }

  @Get('overview')
  @ApiOkResponse({ type: DashboardOverviewDto })
  overview(
    @CurrentTenant() context: TenantContext,
    @Query() query: DashboardOverviewQueryDto,
  ) {
    return this.dashboards.getOverview(context, overviewPeriod(query));
  }
}

interface RequestWithId extends Request {
  requestId?: string;
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

function overviewPeriod(query: DashboardOverviewQueryDto) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - (query.days ?? 31) * 24 * 60 * 60 * 1000);
  return checkedPeriod({ from, to, timezone: 'Asia/Shanghai' });
}

function periodFrom(period: DashboardPeriodDto) {
  return checkedPeriod({
    from: new Date(period.from),
    to: new Date(period.to),
    timezone: period.timezone,
  });
}

function checkedPeriod(input: { from: Date; to: Date; timezone: string }) {
  if (
    input.from >= input.to ||
    input.to.getTime() - input.from.getTime() > 366 * 24 * 60 * 60 * 1000
  ) {
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { from: ['统计区间必须为 1 至 366 天。'] },
    });
  }
  return input;
}
