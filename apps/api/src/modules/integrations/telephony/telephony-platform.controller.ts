import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentSession } from '../../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import type { SessionPrincipal } from '../../auth/session.service';
import {
  AddTelephonyMinutesDto,
  AddTelephonyMinutesResponseDto,
  AssignTelephonyPlanDto,
  PlatformTelephonyResponseDto,
  PlatformTelephonyTokenResponseDto,
  PlatformTenantTelephonyResponseDto,
  TelephonyPlanInputDto,
  TelephonyPlanResponseDto,
  TelephonyPlanVersionQueryDto,
  TelephonyReportQueryDto,
  TelephonyReportResponseDto,
  UpdatePlatformTelephonyDto,
  UpdateTelephonyPlanDto,
} from './telephony-platform.dto';
import {
  TelephonyPlatformService,
  type AuditMeta,
} from './telephony-platform.service';

type RequestWithId = Request & { requestId?: string };
const meta = (req: RequestWithId): AuditMeta => ({
  requestId: req.requestId ?? 'req_unknown',
  ip: req.ip,
});

@Controller('platform')
@ApiTags('platform-telephony')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class TelephonyPlatformController {
  constructor(private readonly service: TelephonyPlatformService) {}

  @Get('telephony-settings')
  @ApiOkResponse({ type: PlatformTelephonyResponseDto })
  line(@CurrentSession() session: SessionPrincipal) {
    return this.service.lineSettings(session.user.id);
  }
  @Patch('telephony-settings')
  @ApiOkResponse({ type: PlatformTelephonyResponseDto })
  updateLine(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: UpdatePlatformTelephonyDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.updateLine(session.user.id, input, meta(req));
  }
  @Post('telephony-settings/callback-token')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTelephonyTokenResponseDto })
  rotateCallbackToken(
    @CurrentSession() session: SessionPrincipal,
    @Req() req: RequestWithId,
  ) {
    return this.service.rotateCallbackToken(session.user.id, meta(req));
  }
  @Get('telephony-plans')
  @ApiOkResponse({ type: [TelephonyPlanResponseDto] })
  plans(@CurrentSession() session: SessionPrincipal) {
    return this.service.plans(session.user.id);
  }
  @Post('telephony-plans')
  @ApiCreatedResponse({ type: TelephonyPlanResponseDto })
  createPlan(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: TelephonyPlanInputDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.createPlan(session.user.id, input, meta(req));
  }
  @Patch('telephony-plans/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TelephonyPlanResponseDto })
  updatePlan(
    @CurrentSession() session: SessionPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTelephonyPlanDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.updatePlan(session.user.id, id, input, meta(req));
  }
  @Delete('telephony-plans/:id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  async deletePlan(
    @CurrentSession() session: SessionPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TelephonyPlanVersionQueryDto,
    @Req() req: RequestWithId,
  ) {
    await this.service.deletePlan(
      session.user.id,
      id,
      query.version,
      meta(req),
    );
  }
  @Get('tenants/:tenantId/telephony')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantTelephonyResponseDto })
  company(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.service.company(session.user.id, tenantId);
  }
  @Patch('tenants/:tenantId/telephony')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantTelephonyResponseDto })
  assign(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() input: AssignTelephonyPlanDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.assign(session.user.id, tenantId, input, meta(req));
  }
  @Post('tenants/:tenantId/telephony/minutes')
  @HttpCode(200)
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: AddTelephonyMinutesResponseDto })
  addMinutes(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() input: AddTelephonyMinutesDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.addMinutes(session.user.id, tenantId, input, meta(req));
  }
  @Get('telephony-report')
  @ApiOkResponse({ type: TelephonyReportResponseDto })
  report(
    @CurrentSession() session: SessionPrincipal,
    @Query() query: TelephonyReportQueryDto,
  ) {
    return this.service.report(session.user.id, query.month);
  }
}
