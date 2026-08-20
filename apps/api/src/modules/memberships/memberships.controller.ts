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

import { CurrentSession } from '../../common/auth/current-user.decorator';
import {
  CurrentTenant,
  CurrentWorkspace,
} from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  WorkspaceGuard,
  type WorkspaceResolution,
} from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import {
  ChangeMemberStatusDto,
  CreateInvitationDto,
  InvitationPageQueryDto,
} from './dto';
import { MembershipsService } from './memberships.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller()
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('me/workspaces')
  @UseGuards(SessionAuthGuard)
  workspaces(@CurrentSession() current: SessionPrincipal) {
    return this.memberships.listWorkspaces(current.user.id);
  }

  @Get('workspaces/:tenantCode')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  workspace(@CurrentWorkspace() workspace: WorkspaceResolution) {
    return workspace;
  }

  @Get('workspaces/:tenantCode/members')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  members(@CurrentTenant() context: TenantContext) {
    return this.memberships.listMembers(context);
  }

  @Get('workspaces/:tenantCode/invitations')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  invitations(
    @CurrentTenant() context: TenantContext,
    @Query() query: InvitationPageQueryDto,
  ) {
    return this.memberships.listInvitations(context, query);
  }

  @Post('workspaces/:tenantCode/invitations')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  invite(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateInvitationDto,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.invite(context, {
      ...dto,
      ...requestMeta(request),
    });
  }

  @Post('workspaces/:tenantCode/invitations/:id/resend')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  resend(
    @CurrentTenant() context: TenantContext,
    @Param('id') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.resendInvitation(context, id, requestMeta(request));
  }

  @Post('workspaces/:tenantCode/invitations/:id/revoke')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  revoke(
    @CurrentTenant() context: TenantContext,
    @Param('id') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.revokeInvitation(context, id, requestMeta(request));
  }

  @Patch('workspaces/:tenantCode/members/:memberId')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  changeMember(
    @CurrentTenant() context: TenantContext,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeMemberStatusDto,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.changeMemberStatus(
      context,
      memberId,
      dto.status,
      requestMeta(request),
    );
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
