import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  PlatformAuditPageDto,
  PlatformAuditQueryDto,
  PlatformOperationPageDto,
  PlatformPageQueryDto,
  RuntimeStatusDto,
} from './dto/platform-operations.dto';
import { PlatformOperationsService } from './platform-operations.service';

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-operations')
@ApiCookieAuth('crm_session')
@Controller('platform')
export class PlatformOperationsController {
  constructor(private readonly operations: PlatformOperationsService) {}

  @Get('audit')
  @ApiOkResponse({ type: PlatformAuditPageDto })
  audit(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: PlatformAuditQueryDto,
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
