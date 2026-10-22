import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  TeamActivityQueryDto,
  TeamActivityResponseDto,
} from './dto/team-activity.dto';
import { TeamActivityService } from './team-activity.service';

@Controller('workspaces/:tenantCode/team-activity')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('team-activity')
@ApiCookieAuth('crm_session')
export class TeamActivityController {
  constructor(private readonly activity: TeamActivityService) {}

  @Get()
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiOkResponse({ type: TeamActivityResponseDto })
  summarize(
    @CurrentTenant() context: TenantContext,
    @Query() query: TeamActivityQueryDto,
  ) {
    return this.activity.summarize(context, query);
  }
}
