import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentTenant } from '../../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import {
  CreateTelephonyCallDto,
  TelephonyBindingResponseDto,
  TelephonyBindingsResponseDto,
  TelephonyCallPageResponseDto,
  TelephonyCallQueryDto,
  TelephonyCallResponseDto,
  TelephonyHookDto,
  TelephonyHookResponseDto,
  TelephonyRuntimeQueryDto,
  TelephonyRuntimeResponseDto,
  TelephonySettingsResponseDto,
  UpdateTelephonyBindingDto,
  UpdateTelephonySettingsDto,
} from './telephony.dto';
import { TelephonyService } from './telephony.service';

@Controller('workspaces/:tenantCode/telephony')
@ApiTags('telephony')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class TelephonyController {
  constructor(private readonly telephony: TelephonyService) {}
  @Get('settings')
  @ApiOkResponse({ type: TelephonySettingsResponseDto })
  settings(@CurrentTenant() context: TenantContext) {
    return this.telephony.settings(context);
  }
  @Patch('settings')
  @ApiOkResponse({ type: TelephonySettingsResponseDto })
  updateSettings(
    @CurrentTenant() context: TenantContext,
    @Body() input: UpdateTelephonySettingsDto,
  ) {
    return this.telephony.updateSettings(context, input);
  }
  @Get('members')
  @ApiOkResponse({ type: TelephonyBindingsResponseDto })
  members(@CurrentTenant() context: TenantContext) {
    return this.telephony.members(context);
  }
  @Patch('members/:memberId')
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: TelephonyBindingResponseDto })
  updateMember(
    @CurrentTenant() context: TenantContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() input: UpdateTelephonyBindingDto,
  ) {
    return this.telephony.updateMember(context, memberId, input);
  }
  @Get('runtime')
  @ApiOkResponse({ type: TelephonyRuntimeResponseDto })
  runtime(
    @CurrentTenant() context: TenantContext,
    @Query() query: TelephonyRuntimeQueryDto,
  ) {
    return this.telephony.runtime(context, query);
  }
  @Post('calls')
  @ApiCreatedResponse({ type: TelephonyCallResponseDto })
  createCall(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateTelephonyCallDto,
  ) {
    return this.telephony.createCall(context, input);
  }
  @Get('calls')
  @ApiOkResponse({ type: TelephonyCallPageResponseDto })
  calls(
    @CurrentTenant() context: TenantContext,
    @Query() query: TelephonyCallQueryDto,
  ) {
    return this.telephony.listCalls(context, query);
  }
  @Get('calls/:callId')
  @ApiParam({ name: 'callId', format: 'uuid' })
  @ApiOkResponse({ type: TelephonyCallResponseDto })
  call(
    @CurrentTenant() context: TenantContext,
    @Param('callId', ParseUUIDPipe) callId: string,
  ) {
    return this.telephony.callDetail(context, callId);
  }
}
@Injectable()
export class TelephonyHookGuard implements CanActivate {
  constructor(private readonly telephony: TelephonyService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      params: { tenantId: string };
      headers: { authorization?: string };
    }>();
    await this.telephony.authenticateHook(
      request.params.tenantId,
      request.headers.authorization,
    );
    return true;
  }
}
@Controller('telephony/hooks')
@ApiTags('telephony')
export class TelephonyHookController {
  constructor(private readonly telephony: TelephonyService) {}
  @Post(':tenantId')
  @HttpCode(200)
  @SetMetadata('telephony:authenticated-hook', true)
  @UseGuards(TelephonyHookGuard)
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description:
      'Bearer tenant callbackToken — proposed contract pending supplier verification',
  })
  @ApiOkResponse({ type: TelephonyHookResponseDto })
  hook(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() input: TelephonyHookDto,
  ) {
    return this.telephony.hook(tenantId, input);
  }
}
