import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentSession } from '../../common/auth/current-user.decorator';
import { ApiException } from '../../common/errors/api.exception';
import {
  SessionAuthGuard,
  SESSION_COOKIE_NAME,
} from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import { AcceptedResponseDto } from '../auth/dto';
import { AvatarService } from './avatar.service';
import { MAX_AVATAR_BYTES } from './avatar-codec';
import {
  AccountMembershipDto,
  AccountNameDto,
  AccountProfileDto,
  AvatarResponseDto,
  JobTitleDto,
} from './profile.dto';
import { UsersService } from './users.service';

type ProfileRequest = Request & { requestId?: string };
const metadata = (req: ProfileRequest) => ({
  requestId: req.requestId ?? 'unknown',
  ip: req.ip,
});

@ApiTags('me')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionAuthGuard)
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly avatars: AvatarService,
  ) {}
  @Get('me')
  @ApiQuery({ name: 'tenantCode', type: String, required: false })
  @ApiOkResponse({ type: AccountProfileDto })
  me(
    @CurrentSession() current: SessionPrincipal,
    @Query('tenantCode') tenantCode?: string,
  ) {
    return this.users.profile(current.user.id, tenantCode);
  }
  @Patch('me/profile')
  @ApiOkResponse({ type: AccountProfileDto })
  rename(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: AccountNameDto,
    @Req() req: ProfileRequest,
  ) {
    return this.users.rename(current.user.id, dto.displayName, metadata(req));
  }
  @Get('me/memberships')
  @ApiOkResponse({ type: AccountMembershipDto, isArray: true })
  memberships(@CurrentSession() current: SessionPrincipal) {
    return this.users.memberships(current.user.id);
  }
  @Patch('me/memberships/:memberId/job-title')
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: AcceptedResponseDto })
  jobTitle(
    @CurrentSession() current: SessionPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: JobTitleDto,
    @Req() req: ProfileRequest,
  ) {
    return this.users.jobTitle(
      current.user.id,
      memberId,
      dto.jobTitle,
      metadata(req),
    );
  }
  @Put('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: AvatarResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  upload(
    @CurrentSession() current: SessionPrincipal,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: ProfileRequest,
  ) {
    if (!file) throw new ApiException('VALIDATION_FAILED', 400);
    return this.avatars.replace(current.user.id, file.buffer, metadata(req));
  }
  @Delete('me/avatar')
  @ApiOkResponse({ type: AvatarResponseDto })
  remove(
    @CurrentSession() current: SessionPrincipal,
    @Req() req: ProfileRequest,
  ) {
    return this.avatars.replace(current.user.id, null, metadata(req));
  }
  @Get('users/:userId/avatar/:version')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiParam({ name: 'version', format: 'uuid' })
  @ApiOkResponse({
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  async avatar(
    @CurrentSession() current: SessionPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('version', ParseUUIDPipe) version: string,
    @Res() res: Response,
  ) {
    const bytes = await this.avatars.read(current.user, userId, version);
    res
      .set({
        'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
        Vary: 'Cookie, Origin',
      })
      .send(bytes);
  }
}
