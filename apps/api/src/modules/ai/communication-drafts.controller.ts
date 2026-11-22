import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import type { Request } from 'express';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CommunicationDraftsService } from './communication-drafts.service';
import {
  CommunicationDraftResponseDto,
  ConfirmCommunicationDraftDto,
  CreateCommunicationDraftDto,
} from './dto/communication-draft.dto';

@Controller(
  'workspaces/:tenantCode/objects/:objectCode/records/:recordId/communication-drafts',
)
@ApiTags('communication-drafts')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode', type: String })
@ApiParam({ name: 'recordId', type: String, format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class CommunicationDraftsController {
  constructor(private readonly drafts: CommunicationDraftsService) {}
  @Post()
  @ApiCreatedResponse({ type: CommunicationDraftResponseDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() body: CreateCommunicationDraftDto,
  ) {
    return this.drafts.create(context, code, recordId, body);
  }
  @Get(':draftId')
  @ApiOkResponse({ type: CommunicationDraftResponseDto })
  get(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Param('draftId', ParseUUIDPipe) id: string,
  ) {
    return this.drafts.get(context, code, recordId, id);
  }
  @Post(':draftId/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: CommunicationDraftResponseDto })
  confirm(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Param('draftId', ParseUUIDPipe) id: string,
    @Body() body: ConfirmCommunicationDraftDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.drafts.confirm(context, code, recordId, id, body.items, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
}
