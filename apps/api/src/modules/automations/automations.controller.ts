import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
  AutomationConfigurationDto,
  AutomationExecutionDto,
  AutomationHistoryDto,
  AutomationPreviewDto,
  ExecuteAutomationDto,
  PreviewAutomationDto,
  PreviewDraftAutomationDto,
  RuntimeAutomationsDto,
  SaveAutomationsDto,
} from './automation.dto';
import { AutomationsService } from './automations.service';

type RequestWithId = Request & { requestId?: string };
function meta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
@Controller('workspaces/:tenantCode/object-definitions/:objectId/automations')
@ApiTags('automations')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode' })
@ApiParam({ name: 'objectId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class AutomationAdminController {
  constructor(private readonly service: AutomationsService) {}
  @Get()
  @ApiOkResponse({ type: AutomationConfigurationDto })
  get(@CurrentTenant() context: TenantContext, @Param('objectId') id: string) {
    return this.service.get(context, id);
  }
  @Put()
  @ApiOkResponse({ type: AutomationConfigurationDto })
  save(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') id: string,
    @Body() body: SaveAutomationsDto,
    @Req() request: RequestWithId,
  ) {
    return this.service.save(context, id, body, meta(request));
  }
  @Post('preview')
  @ApiOkResponse({ type: AutomationPreviewDto })
  preview(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') id: string,
    @Body() body: PreviewDraftAutomationDto,
  ) {
    return this.service.previewDraft(context, id, body);
  }
}
@Controller(
  'workspaces/:tenantCode/objects/:objectCode/records/:recordId/automations',
)
@ApiTags('automations')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode' })
@ApiParam({ name: 'objectCode' })
@ApiParam({ name: 'recordId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class AutomationRuntimeController {
  constructor(private readonly service: AutomationsService) {}
  @Get()
  @ApiOkResponse({ type: RuntimeAutomationsDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId') id: string,
  ) {
    return this.service.list(context, code, id);
  }
  @Get('history')
  @ApiOkResponse({ type: AutomationHistoryDto })
  history(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId') id: string,
  ) {
    return this.service.history(context, code, id);
  }
  @Post(':ruleKey/preview')
  @ApiParam({ name: 'ruleKey' })
  @ApiOkResponse({ type: AutomationPreviewDto })
  preview(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId') id: string,
    @Param('ruleKey') key: string,
    @Body() body: PreviewAutomationDto,
  ) {
    return this.service.preview(context, code, id, key, body.inputs);
  }
  @Post(':ruleKey/execute')
  @ApiParam({ name: 'ruleKey' })
  @ApiOkResponse({ type: AutomationExecutionDto })
  execute(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId') id: string,
    @Param('ruleKey') key: string,
    @Body() body: ExecuteAutomationDto,
    @Req() request: RequestWithId,
  ) {
    return this.service.execute(context, code, id, key, body, meta(request));
  }
}
