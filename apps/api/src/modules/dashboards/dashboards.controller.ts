import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  CreateDashboardDto,
  DashboardConfigurationEnvelopeDto,
  DashboardDefaultsDto,
  DashboardDraftDto,
  DashboardListItemDto,
  DashboardOrderDto,
  DashboardOverviewDto,
  DashboardOverviewQueryDto,
  DashboardPeriodInputDto,
  DashboardPublicationSummaryDto,
  DashboardRuntimeDto,
  PreviewDashboardDto,
  PublishDashboardDto,
  SaveDashboardConfigurationDto,
  UpdateDashboardDto,
} from './dto';
import { DashboardsService } from './dashboards.service';

@Controller('workspaces/:tenantCode/dashboards')
@ApiTags('dashboards')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiExtraModels(DashboardRuntimeDto)
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @ApiOkResponse({ type: DashboardListItemDto, isArray: true })
  list(@CurrentTenant() context: TenantContext) {
    return this.dashboards.list(context);
  }

  @Post()
  @ApiOkResponse({ type: DashboardDraftDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateDashboardDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.create(
      context,
      {
        name: dto.name,
        audience: dto.audience,
        copyFrom: dto.copyFrom,
      },
      requestMeta(request),
    );
  }

  @Patch('defaults')
  @ApiOkResponse({ type: DashboardDefaultsDto })
  setDefaults(
    @CurrentTenant() context: TenantContext,
    @Body() dto: DashboardDefaultsDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.setDefaults(
      context,
      {
        adminDashboardCode: dto.adminDashboardCode,
        employeeDashboardCode: dto.employeeDashboardCode,
      },
      requestMeta(request),
    );
  }

  @Put('order')
  @ApiOkResponse({ type: DashboardListItemDto, isArray: true })
  reorder(
    @CurrentTenant() context: TenantContext,
    @Body() dto: DashboardOrderDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.reorder(context, dto, requestMeta(request));
  }

  @Get('overview')
  @ApiOkResponse({ type: DashboardOverviewDto })
  defaultOverview(
    @CurrentTenant() context: TenantContext,
    @Query() query: DashboardOverviewQueryDto,
  ) {
    return this.dashboards.getOverview(context, overviewPeriod(query));
  }

  @Get(':dashboardCode/configuration')
  @ApiOkResponse({ type: DashboardConfigurationEnvelopeDto })
  configuration(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
  ) {
    return this.dashboards.getConfiguration(context, dashboardCode);
  }

  @Put(':dashboardCode/configuration')
  @ApiOkResponse({ type: DashboardDraftDto })
  saveDraft(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
    @Body() dto: SaveDashboardConfigurationDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.saveDraft(
      context,
      dashboardCode,
      {
        expectedVersion: dto.expectedVersion,
        configuration: dto.configuration,
      },
      requestMeta(request),
    );
  }

  @Patch(':dashboardCode')
  @ApiOkResponse({ type: DashboardDraftDto })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
    @Body() dto: UpdateDashboardDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.update(
      context,
      dashboardCode,
      {
        name: dto.name,
        audience: dto.audience,
        status: dto.status,
      },
      requestMeta(request),
    );
  }

  @Post(':dashboardCode/preview')
  @ApiOkResponse({ type: DashboardRuntimeDto })
  preview(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
    @Body() dto: PreviewDashboardDto,
  ) {
    return this.dashboards.preview(context, dashboardCode, {
      expectedVersion: dto.expectedVersion,
      period: periodFrom(dto.period),
    });
  }

  @Post(':dashboardCode/publications')
  @ApiOkResponse({ type: DashboardPublicationSummaryDto })
  publish(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
    @Body() dto: PublishDashboardDto,
    @Req() request: RequestWithId,
  ) {
    return this.dashboards.publish(
      context,
      dashboardCode,
      { expectedVersion: dto.expectedVersion },
      requestMeta(request),
    );
  }

  @Get(':dashboardCode/overview')
  @ApiOkResponse({ type: DashboardOverviewDto })
  overview(
    @CurrentTenant() context: TenantContext,
    @Param('dashboardCode') dashboardCode: string,
    @Query() query: DashboardOverviewQueryDto,
  ) {
    return this.dashboards.getOverview(context, {
      ...overviewPeriod(query),
      dashboardCode,
    });
  }
}

interface RequestWithId extends Request {
  requestId?: string;
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

export function overviewPeriod(query: DashboardOverviewQueryDto) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - (query.days ?? 30) * 24 * 60 * 60 * 1000);
  return checkedPeriod({ from, to });
}

function periodFrom(period: DashboardPeriodInputDto) {
  return checkedPeriod({
    from: new Date(period.from),
    to: new Date(period.to),
  });
}

function checkedPeriod(input: { from: Date; to: Date }) {
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
