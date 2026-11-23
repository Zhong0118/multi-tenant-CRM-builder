import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TableBuilderService, builderBodies } from './table-builder.service';
import { blueprintSchema } from './table-blueprint';
import type { OpenAPIObject } from '@nestjs/swagger';
type ApiSchema = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>[string];
function schema(value: z.ZodType): ApiSchema {
  const definition = z.toJSONSchema(value, {
    target: 'openapi-3.0',
  });
  delete definition.$schema;
  if (definition.properties?.blueprint)
    definition.properties.blueprint = {
      $ref: '#/components/schemas/TableBlueprint',
    };
  return definition as ApiSchema;
}
function onDisconnect(req: Request) {
  const controller = new AbortController();
  const res = req.res;
  if (!res || res.destroyed) controller.abort();
  else res.once('close', () => controller.abort());
  return controller.signal;
}
export const tableBlueprintDefinition = schema(blueprintSchema);
const issue = z.strictObject({
  tableId: z.string().optional(),
  fieldId: z.string().optional(),
  path: z.string(),
  code: z.string(),
  message: z.string(),
  blocking: z.boolean(),
});
const resultSchema = {
  oneOf: [
    schema(
      z.strictObject({
        kind: z.literal('blueprint'),
        blueprint: blueprintSchema,
        issues: z.array(issue),
      }),
    ),
    schema(
      z.strictObject({
        kind: z.literal('question'),
        key: z.enum(['industry', 'entities']),
        prompt: z.string(),
        options: z.array(z.strictObject({ id: z.string(), label: z.string() })),
      }),
    ),
  ],
};
@Controller('workspaces/:tenantCode/ai/table-builder')
@ApiTags('ai-table-builder')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class TableBuilderController {
  constructor(private readonly builder: TableBuilderService) {}
  @Post('preview')
  @HttpCode(200)
  @ApiBody({ schema: schema(builderBodies.preview) })
  @ApiOkResponse({ schema: resultSchema })
  preview(
    @CurrentTenant() c: TenantContext,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.builder.preview(c, body, onDisconnect(req));
  }
  @Post('validate')
  @HttpCode(200)
  @ApiBody({ schema: schema(builderBodies.validate) })
  @ApiOkResponse({ schema: resultSchema })
  validate(@CurrentTenant() c: TenantContext, @Body() body: unknown) {
    return this.builder.validate(c, body);
  }
  @Post('refine')
  @HttpCode(200)
  @ApiBody({ schema: schema(builderBodies.refine) })
  @ApiOkResponse({ schema: resultSchema })
  refine(
    @CurrentTenant() c: TenantContext,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.builder.refine(c, body, onDisconnect(req));
  }
  @Post('confirm')
  @HttpCode(200)
  @ApiBody({ schema: schema(builderBodies.confirm) })
  @ApiOkResponse({
    schema: schema(
      z.strictObject({
        objects: z.array(
          z.strictObject({
            id: z.uuid(),
            code: z.string(),
            version: z.number().int(),
          }),
        ),
      }),
    ),
  })
  confirm(
    @CurrentTenant() c: TenantContext,
    @Body() body: unknown,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.builder.confirm(c, body, {
      requestId: req.requestId ?? 'req_unknown',
      ip: req.ip,
    });
  }
}
