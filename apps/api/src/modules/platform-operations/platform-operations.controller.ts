import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

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
} from './dto/platform-operations.dto';
import { PlatformOperationsService } from './platform-operations.service';

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-operations')
@ApiCookieAuth('crm_session')
@Controller('platform')
export class PlatformOperationsController {
  constructor(private readonly operations: PlatformOperationsService) {}

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
