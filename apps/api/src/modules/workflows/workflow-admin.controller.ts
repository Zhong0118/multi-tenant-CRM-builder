import {
  Body,
  Controller,
  Get,
  Param,
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
import type { Request } from 'express';

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  SaveWorkflowDraftDto,
  WorkflowDraftResponseDto,
} from './dto/workflow.dto';
import { WorkflowAdminService } from './workflow-admin.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller('workspaces/:tenantCode/object-definitions/:objectId/workflow')
@ApiTags('workflows')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class WorkflowAdminController {
  constructor(private readonly workflows: WorkflowAdminService) {}

  @Get()
  @ApiOkResponse({ type: WorkflowDraftResponseDto })
  get(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
  ) {
    return this.workflows.get(context, objectId);
  }

  @Put()
  @ApiOkResponse({ type: WorkflowDraftResponseDto })
  save(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: SaveWorkflowDraftDto,
    @Req() request: RequestWithId,
  ) {
    return this.workflows.save(context, objectId, dto, {
      requestId: request.requestId ?? 'req_unknown',
      ip: request.ip,
    });
  }
}
