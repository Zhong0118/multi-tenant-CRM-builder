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
import type { Request } from 'express';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  FollowUpRecipientDto,
  CreateFollowUpDto,
  FollowUpPageDto,
  FollowUpQueryDto,
  FollowUpResponseDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import { FollowUpsService } from './follow-ups.service';
@Controller('workspaces/:tenantCode/follow-ups')
@ApiTags('follow-ups')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class FollowUpsController {
  constructor(private readonly service: FollowUpsService) {}
  @Get()
  @ApiOkResponse({ type: FollowUpPageDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Query() query: FollowUpQueryDto,
  ) {
    return this.service.list(context, query);
  }
  @Post()
  @ApiCreatedResponse({ type: FollowUpResponseDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateFollowUpDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.create(context, input, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
  @Get(':id/recipients')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FollowUpRecipientDto, isArray: true })
  recipients(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.recipients(context, id);
  }
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FollowUpResponseDto })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateFollowUpDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.update(context, id, input, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
}
