import {
  Body,
  Controller,
  Get,
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

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  ApplyBusinessTemplateDto,
  TemplateApplicationResponseDto,
  TenantBusinessConfigurationSummaryResponseDto,
} from './dto';
import { TemplateApplicationService } from './template-application.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-business-template-applications')
@ApiCookieAuth('crm_session')
@Controller('platform')
export class TemplateApplicationController {
  constructor(private readonly applications: TemplateApplicationService) {}

  @Get('tenants/:tenantId/business-configuration')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: TenantBusinessConfigurationSummaryResponseDto })
  summarizeTarget(
    @CurrentSession() current: SessionPrincipal,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    return this.applications.summarizeTarget(current.user, tenantId);
  }

  @Post('business-templates/:templateId/applications')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiCreatedResponse({ type: TemplateApplicationResponseDto })
  apply(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: ApplyBusinessTemplateDto,
    @Req() request: RequestWithId,
  ) {
    return this.applications.apply(
      current.user,
      { templateId, ...dto },
      { requestId: request.requestId ?? 'req_unknown', ip: request.ip },
    );
  }
}
