import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
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
  CreatedInvitationResponseDto,
  CreateInvitationDto,
  InvitationPageResponseDto,
  InvitationPageQueryDto,
  InvitationResentResponseDto,
  MemberObjectAccessDto,
  MemberObjectAccessResponseDto,
  MembershipActionResponseDto,
  MemberPageQueryDto,
  TenantMemberResponseDto,
  TenantMemberPageResponseDto,
  WorkspaceSummaryResponseDto,
} from './dto';
import {
  MembershipsService,
  type MemberObjectAccessInput,
} from './memberships.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller()
@ApiTags('memberships')
@ApiCookieAuth('crm_session')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('me/workspaces')
  @UseGuards(SessionAuthGuard)
  @ApiOkResponse({ type: WorkspaceSummaryResponseDto, isArray: true })
  workspaces(@CurrentSession() current: SessionPrincipal) {
    return this.memberships.listWorkspaces(current.user.id);
  }

  @Get('workspaces/:tenantCode')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiOkResponse({ type: WorkspaceSummaryResponseDto })
  workspace(@CurrentWorkspace() workspace: WorkspaceResolution) {
    return workspace;
  }

  @Get('workspaces/:tenantCode/members')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiOkResponse({ type: TenantMemberPageResponseDto })
  members(
    @CurrentTenant() context: TenantContext,
    @Query() query: MemberPageQueryDto,
  ) {
    return this.memberships.listMembers(context, query);
  }

  @Get('workspaces/:tenantCode/invitations')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiOkResponse({ type: InvitationPageResponseDto })
  invitations(
    @CurrentTenant() context: TenantContext,
    @Query() query: InvitationPageQueryDto,
  ) {
    return this.memberships.listInvitations(context, query);
  }

  @Post('workspaces/:tenantCode/invitations')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiCreatedResponse({ type: CreatedInvitationResponseDto })
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
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: InvitationResentResponseDto })
  resend(
    @CurrentTenant() context: TenantContext,
    @Param('id') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.resendInvitation(context, id, requestMeta(request));
  }

  @Post('workspaces/:tenantCode/invitations/:id/revoke')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: MembershipActionResponseDto })
  revoke(
    @CurrentTenant() context: TenantContext,
    @Param('id') id: string,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.revokeInvitation(context, id, requestMeta(request));
  }

  @Patch('workspaces/:tenantCode/members/:memberId')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: TenantMemberResponseDto })
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

  @Get('workspaces/:tenantCode/members/:memberId/object-access')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberObjectAccessResponseDto, isArray: true })
  memberObjectAccess(
    @CurrentTenant() context: TenantContext,
    @Param('memberId') memberId: string,
  ) {
    return this.memberships.listMemberObjectAccess(context, memberId);
  }

  @Put('workspaces/:tenantCode/members/:memberId/object-access/:objectId')
  @UseGuards(SessionAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiParam({ name: 'objectId', format: 'uuid' })
  @ApiOkResponse({ type: MemberObjectAccessResponseDto })
  setMemberObjectAccess(
    @CurrentTenant() context: TenantContext,
    @Param('memberId') memberId: string,
    @Param('objectId') objectId: string,
    @Body() dto: MemberObjectAccessDto,
    @Req() request: RequestWithId,
  ) {
    return this.memberships.setMemberObjectAccess(
      context,
      memberId,
      objectId,
      toMemberObjectAccessInput(dto),
      requestMeta(request),
    );
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

function toMemberObjectAccessInput(
  dto: MemberObjectAccessDto,
): MemberObjectAccessInput {
  if (dto.mode === 'INHERIT') return { mode: 'INHERIT' };
  if (
    dto.canCreate === undefined ||
    dto.canRead === undefined ||
    dto.canUpdate === undefined ||
    dto.readScope === undefined ||
    dto.updateScope === undefined
  ) {
    throw new Error('Validated member object access DTO is incomplete');
  }
  return {
    mode: 'OVERRIDE',
    canCreate: dto.canCreate,
    canRead: dto.canRead,
    canUpdate: dto.canUpdate,
    readScope: dto.readScope,
    updateScope: dto.updateScope,
  };
}
