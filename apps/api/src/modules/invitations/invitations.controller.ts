import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import { InvitationsService } from './invitations.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@UseGuards(SessionAuthGuard)
@Controller('me/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list(@CurrentSession() current: SessionPrincipal) {
    return this.invitations.list(current.user);
  }

  @Get(':invitationId')
  detail(
    @CurrentSession() current: SessionPrincipal,
    @Param('invitationId') id: string,
  ) {
    return this.invitations.detail(current.user, id);
  }

  @Post(':invitationId/accept')
  accept(
    @CurrentSession() current: SessionPrincipal,
    @Param('invitationId') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.invitations.accept(current.user, id, requestMeta(request));
  }

  @Post(':invitationId/decline')
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
