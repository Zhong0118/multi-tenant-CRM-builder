import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { importPlanSchema, importRequestSchema } from './dto/import-assist.dto';
import { ImportAssistService } from './import-assist.service';

type SchemaObject = Extract<
  Parameters<typeof ApiOkResponse>[0],
  { schema: unknown }
>['schema'];

@Controller('workspaces/:tenantCode/objects/:objectCode/import-assist')
@ApiTags('import-assist')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class ImportAssistController {
  constructor(private readonly service: ImportAssistService) {}
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: z.toJSONSchema(importRequestSchema, {
      target: 'openapi-3.0',
    }) as SchemaObject,
  })
  @ApiOkResponse({
    schema: z.toJSONSchema(importPlanSchema, {
      target: 'openapi-3.0',
    }) as SchemaObject,
  })
  async preview(
    @CurrentTenant() actor: TenantContext,
    @Param('objectCode') code: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stop = new AbortController();
    const close = () => stop.abort();
    res.once('close', close);
    try {
      return await this.service.preview(actor, code, body, stop.signal);
    } finally {
      res.off('close', close);
    }
  }
}
