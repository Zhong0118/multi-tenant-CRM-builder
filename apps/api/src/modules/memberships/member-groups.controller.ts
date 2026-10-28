import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import type { RequestWithId } from '../../common/security/request-id.middleware';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  CreateMemberGroupDto,
  DeleteMemberGroupDto,
  DeleteMemberGroupResponseDto,
  MemberGroupDto,
  MemberGroupListDto,
  UpdateMemberGroupDto,
} from './dto/member-groups.dto';
import { MemberGroupsService } from './member-groups.service';

@Controller('workspaces/:tenantCode/member-groups')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('memberships')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
export class MemberGroupsController {
  constructor(private readonly groups: MemberGroupsService) {}
  @Get()
  @ApiOkResponse({ type: MemberGroupListDto })
  list(@CurrentTenant() context: TenantContext) {
    return this.groups.list(context);
  }

  @Post()
  @ApiCreatedResponse({ type: MemberGroupDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateMemberGroupDto,
    @Req() request: RequestWithId,
  ) {
    return this.groups.create(context, input, meta(request));
  }

  @Patch(':groupId')
  @ApiParam({ name: 'groupId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: MemberGroupDto })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('groupId', ParseUUIDPipe) id: string,
    @Body() input: UpdateMemberGroupDto,
    @Req() request: RequestWithId,
  ) {
    return this.groups.update(context, id, input, meta(request));
  }

  @Delete(':groupId')
  @ApiParam({ name: 'groupId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DeleteMemberGroupResponseDto })
  delete(
    @CurrentTenant() context: TenantContext,
    @Param('groupId', ParseUUIDPipe) id: string,
    @Body() input: DeleteMemberGroupDto,
    @Req() request: RequestWithId,
  ) {
    return this.groups.delete(
      context,
      id,
      input.expectedVersion,
      meta(request),
    );
  }
}

function meta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
