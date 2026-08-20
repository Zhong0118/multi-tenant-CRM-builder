import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  ChangeTenantStatusDto,
  CreatePlatformTenantDto,
  PlatformTenantResponseDto,
  PlatformTenantPageQueryDto,
  PlatformTenantPageResponseDto,
} from './dto';
import { TenantsService } from './tenants.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-tenants')
@ApiCookieAuth('crm_session')
@Controller('platform/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantPageResponseDto })
  list(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: PlatformTenantPageQueryDto,
  ) {
    return this.tenants.list(current.user, query);
  }

  @Post()
  @ApiCreatedResponse({ type: PlatformTenantResponseDto })
  create(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: CreatePlatformTenantDto,
    @Req() request: RequestWithId,
  ) {
    return this.tenants.createTenant(current.user, {
      ...dto,
      requestId: request.requestId ?? 'req_unknown',
      ip: request.ip,
    });
  }

  @Get(':tenantId')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  detail(
    @CurrentSession() current: SessionPrincipal,
    @Param('tenantId') tenantId: string,
  ) {
    return this.tenants.detail(current.user, tenantId);
  }

  @Patch(':tenantId/status')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  changeStatus(
    @CurrentSession() current: SessionPrincipal,
    @Param('tenantId') tenantId: string,
    @Body() dto: ChangeTenantStatusDto,
    @Req() request: RequestWithId,
  ) {
    return this.tenants.changeStatus(current.user, tenantId, dto.status, {
      reason: dto.reason,
      requestId: request.requestId ?? 'req_unknown',
      ip: request.ip,
    });
  }
}
