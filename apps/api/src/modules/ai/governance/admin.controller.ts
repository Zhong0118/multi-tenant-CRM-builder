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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentSession } from '../../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { CurrentTenant } from '../../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import type { SessionPrincipal } from '../../auth/session.service';
import { PlatformAiAdminService } from './admin-platform.service';
import { WorkspaceAiAdminService } from './admin-workspace.service';
import {
  body,
  inputs,
  outputs,
  query,
  response,
  validated,
} from './admin.contract';

type ReqWithId = Request & { requestId?: string };
const meta = (req: ReqWithId) => ({
  requestId: req.requestId ?? 'req_unknown',
  ip: req.ip,
});
const uuid = (id: string) => validated(z.uuid(), id);
@Controller('platform')
@ApiTags('platform-ai-governance')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class PlatformAiAdminController {
  constructor(private readonly service: PlatformAiAdminService) {}
  @Get('ai-plans')
  @response(outputs.plans)
  plans(@CurrentSession() session: SessionPrincipal) {
    return this.service.list(session.user.id);
  }
  @Get('ai-plans/:id')
  @response(outputs.plan)
  plan(@CurrentSession() session: SessionPrincipal, @Param('id') id: string) {
    return this.service.plan(session.user.id, uuid(id));
  }
  @Post('ai-plans')
  @HttpCode(200)
  @body(inputs.plan)
  @response(outputs.plan)
  create(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.create(
      session.user.id,
      validated(inputs.plan, input),
      meta(req),
    );
  }
  @Post('ai-plans/:id/preview')
  @HttpCode(200)
  @body(inputs.planEdit)
  @response(outputs.planImpact)
  preview(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.preview(
      session.user.id,
      uuid(id),
      validated(inputs.planEdit, input),
    );
  }
  @Patch('ai-plans/:id')
  @body(inputs.savePlan)
  @response(outputs.plan)
  update(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.update(
      session.user.id,
      uuid(id),
      validated(inputs.savePlan, input),
      meta(req),
    );
  }
  @Delete('ai-plans/:id')
  @body(inputs.deletePlan)
  @response(outputs.deleted)
  remove(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.remove(
      session.user.id,
      uuid(id),
      validated(inputs.deletePlan, input).version,
      meta(req),
    );
  }
  @Get('ai-settings')
  @response(outputs.platform)
  settings(@CurrentSession() session: SessionPrincipal) {
    return this.service.runtime(session.user.id);
  }
  @Patch('ai-settings')
  @body(inputs.settings)
  @response(outputs.settings)
  saveSettings(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.saveSettings(
      session.user.id,
      validated(inputs.settings, input),
      meta(req),
    );
  }
  @Get('ai-companies')
  @query(inputs.companies)
  @response(outputs.companies)
  companies(
    @CurrentSession() session: SessionPrincipal,
    @Query() params: unknown,
  ) {
    return this.service.companies(
      session.user.id,
      validated(inputs.companies, params),
    );
  }
  @Get('tenants/:id/ai')
  @response(outputs.summary)
  company(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
  ) {
    return this.service.summary(session.user.id, uuid(id));
  }
  @Post('tenants/:id/ai/preview')
  @HttpCode(200)
  @body(inputs.assign)
  @response(outputs.assignment)
  previewAssignment(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.previewAssignment(
      session.user.id,
      uuid(id),
      validated(inputs.assign, input).planId,
    );
  }
  @Patch('tenants/:id/ai')
  @body(inputs.saveAssignment)
  @response(outputs.tenant)
  assign(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.assign(
      session.user.id,
      uuid(id),
      validated(inputs.saveAssignment, input),
      meta(req),
    );
  }
  @Post('tenants/:id/ai/quota')
  @HttpCode(200)
  @body(inputs.quota)
  @response(outputs.topUp)
  topUp(
    @CurrentSession() session: SessionPrincipal,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.topUp(
      session.user.id,
      uuid(id),
      validated(inputs.quota, input),
      meta(req),
    );
  }
}
@Controller('workspaces/:tenantCode/ai')
@ApiTags('workspace-ai-governance')
@ApiParam({ name: 'tenantCode', type: String })
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class WorkspaceAiAdminController {
  constructor(private readonly service: WorkspaceAiAdminService) {}
  @Get('capabilities')
  @response(outputs.capabilities)
  capabilities(@CurrentTenant() c: TenantContext) {
    return this.service.capabilities(c);
  }
  @Get('settings')
  @response(outputs.workspace)
  settings(@CurrentTenant() c: TenantContext) {
    return this.service.settings(c);
  }
  @Patch('settings')
  @body(inputs.allocation)
  @response(outputs.workspace)
  allocation(
    @CurrentTenant() c: TenantContext,
    @Body() input: unknown,
    @Req() req: ReqWithId,
  ) {
    return this.service.allocation(
      c,
      validated(inputs.allocation, input),
      meta(req),
    );
  }
  @Get('usage')
  @response(outputs.usage)
  usage(@CurrentTenant() c: TenantContext) {
    return this.service.usage(c);
  }
  @Get('operations')
  @query(inputs.operations)
  @response(outputs.operations)
  operations(@CurrentTenant() c: TenantContext, @Query() params: unknown) {
    return this.service.operations(c, validated(inputs.operations, params));
  }
  @Get('operations/:id')
  @response(outputs.detail)
  detail(@CurrentTenant() c: TenantContext, @Param('id') id: string) {
    return this.service.detail(c, uuid(id));
  }
}
