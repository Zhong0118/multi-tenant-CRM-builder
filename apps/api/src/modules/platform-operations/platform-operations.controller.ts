import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { MailService } from '../mail/mail.service';
import { ApiException } from '../../common/errors/api.exception';
import type { RequestWithId } from '../../common/security/request-id.middleware';
import { CurrentSession } from '../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  PlatformAuditFacetQueryDto,
  PlatformAuditFilterDto,
  PlatformAuditFacetsDto,
  PlatformAuditPageDto,
  PlatformOperationPageDto,
  PlatformPageQueryDto,
  RuntimeStatusDto,
  MailTestResultDto,
  MailStatisticsDto,
} from './dto/platform-operations.dto';
import { PlatformOperationsService } from './platform-operations.service';

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-operations')
@ApiCookieAuth('crm_session')
@Controller('platform')
export class PlatformOperationsController {
  constructor(
    private readonly operations: PlatformOperationsService,
    private readonly mail: MailService,
  ) {}

  @Post('mail/test')
  @HttpCode(200)
  @ApiOkResponse({ type: MailTestResultDto })
  testMail(
    @CurrentSession() current: SessionPrincipal,
    @Req() req: RequestWithId,
    @Body() body: unknown,
  ) {
    if (
      body !== undefined &&
      (body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '测试邮件只寄到本人已验证的邮箱。',
      });
    }
    return this.mail.test(current.user.id, req.requestId);
  }

  @Get('mail/statistics')
  @ApiOkResponse({ type: MailStatisticsDto })
  mailStatistics() {
    return this.mail.statistics();
  }

  @Get('audit/facets')
  @ApiOkResponse({ type: PlatformAuditFacetsDto })
  auditFacets(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: PlatformAuditFacetQueryDto,
  ) {
    return this.operations.auditFacets(current.user.id, query.tenantId);
  }

  @Get('audit')
  @ApiOkResponse({ type: PlatformAuditPageDto })
  audit(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: PlatformAuditFilterDto,
  ) {
    return this.operations.listAudit(current.user.id, query);
  }

  @Get('operations')
  @ApiOkResponse({ type: PlatformOperationPageDto })
  operationHistory(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: PlatformPageQueryDto,
  ) {
    return this.operations.listOperations(current.user.id, query);
  }

  @Get('runtime-status')
  @ApiOkResponse({ type: RuntimeStatusDto })
  runtimeStatus() {
    return this.operations.runtimeStatus();
  }
}
