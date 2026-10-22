import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
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
  CreateWorkTaskDto,
  UpdateWorkTaskDto,
  WorkTaskDto,
  WorkTaskPageDto,
  WorkTaskQueryDto,
} from './dto/work.dto';
import { WorkTasksService } from './work-tasks.service';

@Controller('workspaces/:tenantCode/work-tasks')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('work')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
export class WorkTasksController {
  constructor(private readonly tasks: WorkTasksService) {}

  @Get()
  @ApiOkResponse({ type: WorkTaskPageDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Query() query: WorkTaskQueryDto,
  ) {
    return this.tasks.list(context, query);
  }

  @Post()
  @ApiCreatedResponse({ type: WorkTaskDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() body: CreateWorkTaskDto,
    @Req() request: RequestWithId,
  ) {
    return this.tasks.create(context, body, meta(request));
  }

  @Patch(':taskId')
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiOkResponse({ type: WorkTaskDto })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() body: UpdateWorkTaskDto,
    @Req() request: RequestWithId,
  ) {
    return this.tasks.update(context, taskId, body, meta(request));
  }
}

function meta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
