import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import { CurrentTenant } from '../../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { DailyBriefService } from './daily-brief.service';
@Controller('workspaces/:tenantCode/daily-brief')
@ApiTags('daily-brief')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class DailyBriefController {
  constructor(private readonly service: DailyBriefService) {}
  @Get() @Header('Cache-Control', 'private, no-store') list(
    @CurrentTenant() a: TenantContext,
    @Query('group') group?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.list(a, group, cursor);
  }
  @Get('settings') settings(@CurrentTenant() a: TenantContext) {
    return this.service.settings(a);
  }
  @Put('settings') save(
    @CurrentTenant() a: TenantContext,
    @Body() data: unknown,
  ) {
    return this.service.save(a, data);
  }
  @Get('suggestions') @Header('Cache-Control', 'private, no-store') suggestions(
    @CurrentTenant() a: TenantContext,
  ) {
    return this.service.suggestions(a);
  }
  @Post('generate')
  @Header('Cache-Control', 'private, no-store')
  async generate(
    @CurrentTenant() a: TenantContext,
    @Body() data: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = z
      .strictObject({ previous: z.iso.datetime().nullable().optional() })
      .safeParse(data ?? {});
    if (!parsed.success) throw new ApiException('VALIDATION_FAILED', 400);
    const c = new AbortController();
    const close = () => c.abort();
    response.once('close', close);
    try {
      return await this.service.generate(
        a,
        parsed.data.previous ?? null,
        c.signal,
      );
    } finally {
      response.off('close', close);
    }
  }
}
