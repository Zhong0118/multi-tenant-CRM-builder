import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { RequestWithId } from '../../common/security/request-id.middleware';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  DailyReportDto,
  DailyReportListDto,
  DailyReportViewDto,
  SaveDailyReportDto,
} from './dto/work.dto';
import { DailyReportsService } from './daily-reports.service';

@Controller('workspaces/:tenantCode/daily-reports')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('work')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
export class DailyReportsController {
  constructor(private readonly reports: DailyReportsService) {}

  /** Who reported for a work date (administrators). */
  @Get(':workDate')
  @ApiParam({
    name: 'workDate',
    type: String,
    example: '2026-10-22',
    description: 'A company calendar day, or `today` in the company timezone.',
  })
  @ApiOkResponse({ type: DailyReportListDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Param('workDate') workDate: string,
  ) {
    return this.reports.listForDate(context, workDate);
  }

  /** The acting member's own report for a work date, with that day's reference. */
  @Get(':workDate/mine')
  @ApiParam({
    name: 'workDate',
    type: String,
    example: '2026-10-22',
    description: 'A company calendar day, or `today` in the company timezone.',
  })
  @ApiOkResponse({ type: DailyReportViewDto })
  mine(
    @CurrentTenant() context: TenantContext,
    @Param('workDate') workDate: string,
  ) {
    return this.reports.get(context, workDate);
  }

  @Put(':workDate/mine')
  @ApiParam({
    name: 'workDate',
    type: String,
    example: '2026-10-22',
    description: 'A company calendar day, or `today` in the company timezone.',
  })
  @ApiOkResponse({ type: DailyReportDto })
  save(
    @CurrentTenant() context: TenantContext,
    @Param('workDate') workDate: string,
    @Body() body: SaveDailyReportDto,
    @Req() request: RequestWithId,
  ) {
    return this.reports.save(context, workDate, body, {
      requestId: request.requestId ?? 'req_unknown',
      ip: request.ip,
    });
  }

  /** A member's report (administrators, or the member themself). */
  @Get(':workDate/members/:memberId')
  @ApiParam({
    name: 'workDate',
    type: String,
    example: '2026-10-22',
    description: 'A company calendar day, or `today` in the company timezone.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: DailyReportViewDto })
  member(
    @CurrentTenant() context: TenantContext,
    @Param('workDate') workDate: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.reports.get(context, workDate, memberId);
  }
}
