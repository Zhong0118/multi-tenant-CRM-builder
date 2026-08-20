import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  InvitationActionResponseDto,
  InvitationMembershipResponseDto,
  PersonalInvitationResponseDto,
} from './dto';
import { InvitationsService } from './invitations.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@UseGuards(SessionAuthGuard)
@ApiTags('invitations')
@ApiCookieAuth('crm_session')
@Controller('me/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @ApiOkResponse({ type: PersonalInvitationResponseDto, isArray: true })
  list(@CurrentSession() current: SessionPrincipal) {
    return this.invitations.list(current.user);
  }

  @Get(':invitationId')
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiOkResponse({ type: PersonalInvitationResponseDto })
  detail(
    @CurrentSession() current: SessionPrincipal,
    @Param('invitationId') id: string,
  ) {
    return this.invitations.detail(current.user, id);
  }

  @Post(':invitationId/accept')
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiCreatedResponse({ type: InvitationMembershipResponseDto })
  accept(
    @CurrentSession() current: SessionPrincipal,
    @Param('invitationId') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.invitations.accept(current.user, id, requestMeta(request));
  }

  @Post(':invitationId/decline')
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiCreatedResponse({ type: InvitationActionResponseDto })
  decline(
    @CurrentSession() current: SessionPrincipal,
    @Param('invitationId') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.invitations.decline(current.user, id, requestMeta(request));
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
