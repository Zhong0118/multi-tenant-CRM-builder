import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { AuthService, type AuthenticatedSessionResult } from './auth.service';
import {
  ChangePasswordDto,
  AcceptedResponseDto,
  AuthenticatedResponseDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SessionPageQueryDto,
  SessionPageResponseDto,
  UserResponseDto,
  VerificationChallengeDto,
} from './dto';
import { SESSION_COOKIE_NAME, SessionAuthGuard } from './session-auth.guard';
import type { SessionPrincipal } from './session.service';

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || '127.0.0.1';
}

function publicAuthResult(
  response: Response,
  result: AuthenticatedSessionResult,
) {
  const localHttp = (
    process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .every((origin) =>
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin),
    );
  response.cookie(SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !localHttp,
    expires: result.expiresAt,
    path: '/',
  });
  return { accepted: result.accepted, user: result.user };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('verification-challenges')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  requestVerification(
    @Body() dto: VerificationChallengeDto,
    @Req() request: Request,
  ) {
    return this.auth.requestVerification({
      ...dto,
      requestIp: requestIp(request),
    });
  }

  @Post('register')
  @ApiCreatedResponse({ type: AuthenticatedResponseDto })
  register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth
      .register({ ...dto, ip: requestIp(request) })
      .then((result) => publicAuthResult(response, result));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthenticatedResponseDto })
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth
      .login({ ...dto, ip: requestIp(request) })
      .then((result) => publicAuthResult(response, result));
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponseDto })
  async logout(
    @CurrentSession() current: SessionPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(current.user.id, current.sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { accepted: true };
  }

  @Post('forgot-password')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request) {
    return this.auth.requestVerification({
      ...dto,
      purpose: 'RESET_PASSWORD',
      requestIp: requestIp(request),
    });
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: AcceptedResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}

@ApiTags('me')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentSession() current: SessionPrincipal) {
    const user = await this.auth.getUser(current.user.id);
    return {
      id: user.id,
      displayName: user.displayName,
      phone: user.phone,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }

  @Get('sessions')
  @ApiOkResponse({ type: SessionPageResponseDto })
  sessions(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: SessionPageQueryDto,
  ) {
    return this.auth.listSessions(current.user.id, current.sessionId, query);
  }

  @Delete('sessions/:sessionId')
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiOkResponse({ type: AcceptedResponseDto })
  revokeSession(
    @CurrentSession() current: SessionPrincipal,
    @Param('sessionId') sessionId: string,
  ) {
    return this.auth.revokeSession(current.user.id, sessionId);
  }

  @Patch('password')
  @ApiOkResponse({ type: AcceptedResponseDto })
  changePassword(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword({
      ...dto,
      userId: current.user.id,
      currentSessionId: current.sessionId,
    });
  }
}
