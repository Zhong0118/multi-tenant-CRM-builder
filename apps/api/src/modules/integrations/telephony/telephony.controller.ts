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
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiException } from '../../../common/errors/api.exception';
import { validationFieldErrors } from '../../../common/errors/validation-field-errors';
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
  @Post('calls/:callId/close')
  @HttpCode(200)
  @ApiParam({ name: 'callId', format: 'uuid' })
  @ApiOkResponse({ type: TelephonyCallResponseDto })
  closeCall(
    @CurrentTenant() context: TenantContext,
    @Param('callId', ParseUUIDPipe) callId: string,
  ) {
    return this.telephony.closeCall(context, callId);
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
      headers: { authorization?: string };
      query: Record<string, unknown>;
    }>();
    await this.telephony.authenticateHook(
      request.headers.authorization,
      request.query?.token,
    );
    return true;
  }
}
@Controller('telephony/hooks')
@ApiTags('telephony')
export class TelephonyHookController {
  constructor(private readonly telephony: TelephonyService) {}
  @Post()
  @HttpCode(200)
  @SetMetadata('telephony:authenticated-hook', true)
  @UseGuards(TelephonyHookGuard)
  @ApiHeader({
    name: 'Authorization',
    required: false,
    description: 'Bearer callback credential; or pass it as the token query',
  })
  @ApiQuery({ name: 'token', required: false })
  @ApiOkResponse({ type: TelephonyHookResponseDto })
  @ApiBody({ type: TelephonyHookDto })
  async hook(
    // Untyped so the global pipe does not reject fields the supplier may add;
    // the known fields are still validated strictly below.
    @Body() raw: unknown,
  ) {
    const input = plainToInstance(
      TelephonyHookDto,
      raw && typeof raw === 'object' ? raw : {},
    );
    const errors = await validate(input, { whitelist: true });
    if (errors.length)
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: validationFieldErrors(errors),
      });
    return this.telephony.hook(input);
  }
}
