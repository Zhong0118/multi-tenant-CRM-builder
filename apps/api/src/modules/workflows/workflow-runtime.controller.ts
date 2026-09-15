import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import type { Request } from 'express';

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  ExecuteWorkflowTransitionDto,
  RuntimeWorkflowResponseDto,
  WorkflowHistoryPageDto,
  WorkflowHistoryQueryDto,
} from './dto/workflow.dto';
import { WorkflowRuntimeService } from './workflow-runtime.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller(
  'workspaces/:tenantCode/objects/:objectCode/records/:recordId/workflow',
)
@ApiTags('workflows')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode' })
@ApiParam({ name: 'recordId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class WorkflowRuntimeController {
  constructor(private readonly runtime: WorkflowRuntimeService) {}

  @Get()
  @ApiOkResponse({ type: RuntimeWorkflowResponseDto })
  get(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
  ) {
    return this.runtime.get(context, objectCode, recordId);
  }

  @Get('history')
  @ApiOkResponse({ type: WorkflowHistoryPageDto })
  history(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Query() query: WorkflowHistoryQueryDto,
  ) {
    return this.runtime.history(context, objectCode, recordId, query);
  }

  @Post('transitions/:transitionKey')
  @ApiOkResponse({ type: RuntimeWorkflowResponseDto })
  execute(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Param('transitionKey') transitionKey: string,
    @Body() dto: ExecuteWorkflowTransitionDto,
    @Req() request: RequestWithId,
  ) {
    return this.runtime.execute(
      context,
      objectCode,
      recordId,
      transitionKey,
      dto,
      {
        requestId: request.requestId ?? 'req_unknown',
        ip: request.ip,
      },
    );
  }
}
