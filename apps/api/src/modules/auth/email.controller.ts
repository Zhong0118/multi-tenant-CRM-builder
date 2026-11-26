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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PickType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import {
  AcceptedResponseDto,
  ChangePasswordDto,
  ResetPasswordDto,
} from './dto';
import {
  EmailIdentityService,
  type EmailPurpose,
} from './email-identity.service';
import { SESSION_COOKIE_NAME, SessionAuthGuard } from './session-auth.guard';
import type { SessionPrincipal } from './session.service';

const purposes: EmailPurpose[] = ['BIND', 'CHANGE', 'REVERIFY'];
class NewEmailCodeDto {
  @ApiProperty({ enum: purposes }) @IsIn(purposes) purpose!: EmailPurpose;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;
  @ApiPropertyOptional({ format: 'password' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}
class VerifyEmailDto extends NewEmailCodeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
  @ApiProperty({ pattern: '^[0-9]{6}$' }) @Matches(/^\d{6}$/) code!: string;
}
class EmailAddressDto {
  @ApiProperty({ format: 'email' }) @IsString() @MaxLength(320) email!: string;
}
class ResetEmailPasswordDto extends PickType(ResetPasswordDto, [
  'newPassword',
] as const) {
  @ApiProperty({ format: 'email' }) @IsString() @MaxLength(320) email!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
  @ApiProperty({ pattern: '^[0-9]{6}$' }) @Matches(/^\d{6}$/) code!: string;
}
class RemoveEmailDto extends PickType(ChangePasswordDto, [
  'currentPassword',
] as const) {}
class EmailStatusDto {
  @ApiProperty() mailAvailable!: boolean;
}
class EmailChallengeDto {
  @ApiProperty({ format: 'uuid' }) challengeId!: string;
  @ApiProperty() maskedEmail!: string;
}
class RecoveryChallengeDto {
  @ApiProperty({ format: 'uuid' }) challengeId!: string;
  @ApiProperty() message!: string;
}
class DeviceMailSettingsDto {
  @ApiProperty() @IsBoolean() newDeviceMailEnabled!: boolean;
}
const ip = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

@ApiTags('auth')
@Controller('auth/email')
export class EmailRecoveryController {
  constructor(private readonly identity: EmailIdentityService) {}
  @Get('status')
  @ApiOkResponse({ type: EmailStatusDto })
  status() {
    return { mailAvailable: this.identity.mail.available };
  }
  @Post('forgot-password')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: RecoveryChallengeDto })
  forgot(@Body() dto: EmailAddressDto, @Req() req: Request) {
    return this.identity.forgot(dto.email, ip(req));
  }
  @Post('reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponseDto })
  reset(@Body() dto: ResetEmailPasswordDto, @Req() req: Request) {
    return this.identity.reset(dto, ip(req));
  }
}

@ApiTags('me')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionAuthGuard)
@Controller('me')
export class AccountEmailController {
  constructor(private readonly identity: EmailIdentityService) {}
  @Post('email/challenges')
  @HttpCode(200)
  @ApiOkResponse({ type: EmailChallengeDto })
  issue(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: NewEmailCodeDto,
    @Req() req: Request,
  ) {
    return this.identity.issue(current.user.id, dto, ip(req));
  }
  @Delete('email/challenges/:challengeId')
  @ApiOkResponse({ type: AcceptedResponseDto })
  cancel(
    @CurrentSession() current: SessionPrincipal,
    @Param('challengeId', ParseUUIDPipe) id: string,
  ) {
    return this.identity.cancel(current.user.id, id);
  }
  @Post('email/verify')
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponseDto })
  verify(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ) {
    return this.identity.verify(current.user.id, dto, ip(req));
  }
  @Delete('email')
  @ApiOkResponse({ type: AcceptedResponseDto })
  remove(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: RemoveEmailDto,
  ) {
    return this.identity.remove(current.user.id, dto.currentPassword);
  }
  @Get('notification-settings')
  @ApiOkResponse({ type: DeviceMailSettingsDto })
  settings(@CurrentSession() current: SessionPrincipal) {
    return this.identity.settings(current.user.id);
  }
  @Patch('notification-settings')
  @ApiOkResponse({ type: DeviceMailSettingsDto })
  updateSettings(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: DeviceMailSettingsDto,
  ) {
    return this.identity.updateSettings(
      current.user.id,
      dto.newDeviceMailEnabled,
    );
  }
}
