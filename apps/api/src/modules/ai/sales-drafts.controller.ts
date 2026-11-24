import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SalesDraftsService } from './sales-drafts.service';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api.exception';

function disconnect(res: Response) {
  const stop = new AbortController();
  res.once('close', () => stop.abort());
  return stop.signal;
}

@Controller('workspaces/:tenantCode/ai')
@ApiTags('sales-drafts')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class SalesDraftsController {
  constructor(private readonly drafts: SalesDraftsService) {}
  @Post('writing/:objectCode/:recordId')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'purpose', 'length', 'tone'],
      properties: {
        kind: { type: 'string' },
        purpose: { type: 'string' },
        tone: { type: 'string' },
        length: { type: 'string' },
        supplement: { type: 'string', maxLength: 1000 },
        rewrite: {
          type: 'object',
          required: ['basis', 'mode', 'refs', 'previousLength'],
          properties: {
            basis: { type: 'string' },
            mode: { type: 'string', enum: ['regenerate', 'shorter', 'formal'] },
            refs: { type: 'array', items: { type: 'string' } },
            previousLength: { type: 'integer' },
          },
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Newline-delimited JSON. Metadata, verified text blocks, then completion.',
  })
  async write(
    @CurrentTenant() actor: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const draft = await this.drafts.write(
      actor,
      code,
      id,
      body,
      disconnect(res),
    );
    if (res.destroyed) return;
    const { blocks, ...meta } = draft;
    res.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.write(JSON.stringify({ type: 'meta', ...meta }) + '\n');
    for (const block of blocks)
      res.write(JSON.stringify({ type: 'block', block }) + '\n');
    res.end('{"type":"done"}\n');
  }
  @Get('writing/:objectCode/:recordId/activity-access')
  @Header('Cache-Control', 'no-store')
  checkActivity(
    @CurrentTenant() actor: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) id: string,
  ) {
    return this.drafts.checkActivity(actor, code, id);
  }
  @Post('daily-report')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['workDate'],
      properties: { workDate: { type: 'string', format: 'date' } },
    },
  })
  async report(
    @CurrentTenant() actor: TenantContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = z
      .strictObject({ workDate: z.string().max(10) })
      .safeParse(body);
    if (!input.success) throw new ApiException('VALIDATION_FAILED', 400);
    return this.drafts.report(actor, input.data.workDate, disconnect(res));
  }
}
