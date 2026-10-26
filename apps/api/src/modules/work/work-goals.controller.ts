import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
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
  GOAL_METRICS,
  SaveWorkGoalDto,
  WorkGoalDto,
  WorkGoalProgressDto,
  WorkGoalProgressQueryDto,
  WorkGoalSettingsDto,
} from './dto/work-goals.dto';
import { WorkGoalsService } from './work-goals.service';
@Controller('workspaces/:tenantCode/work-goals')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('work')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
export class WorkGoalsController {
  constructor(private readonly goals: WorkGoalsService) {}
  @Get('settings')
  @ApiOkResponse({ type: WorkGoalSettingsDto })
  settings(@CurrentTenant() context: TenantContext) {
    return this.goals.settings(context);
  }
  @Get('progress')
  @ApiOkResponse({ type: WorkGoalProgressDto })
  progress(
    @CurrentTenant() context: TenantContext,
    @Query() query: WorkGoalProgressQueryDto,
  ) {
    return this.goals.progress(context, query);
  }
  @Put(':metric')
  @ApiParam({ name: 'metric', enum: GOAL_METRICS })
  @ApiOkResponse({ type: WorkGoalDto })
  save(
    @CurrentTenant() context: TenantContext,
    @Param('metric') metric: string,
    @Body() input: SaveWorkGoalDto,
    @Req() request: RequestWithId,
  ) {
    return this.goals.save(context, metric, input, {
      requestId: request.requestId ?? 'req_unknown',
      ip: request.ip,
    });
  }
}
