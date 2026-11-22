import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { FilterRule } from '@crm/contracts';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { FilterPreviewService } from './filter-preview.service';

class FilterPreviewBody {
  @ApiProperty() @IsString() @MaxLength(2000) @Matches(/\S/) text!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  currentRule!: FilterRule;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  baseViewId?: string;
}
const ruleSchema = { type: 'object', additionalProperties: true } as const;
@Controller('workspaces/:tenantCode/objects/:objectCode/filter-preview')
@ApiTags('filter-preview')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class FilterPreviewController {
  constructor(private readonly previews: FilterPreviewService) {}
  @Post()
  @HttpCode(200)
  @ApiOkResponse({
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['kind', 'rule'],
          properties: {
            kind: { type: 'string', enum: ['rule'] },
            rule: ruleSchema,
          },
        },
        {
          type: 'object',
          required: ['kind', 'options'],
          properties: {
            kind: { type: 'string', enum: ['clarify'] },
            options: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'label', 'value'],
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  value: ruleSchema,
                },
              },
            },
          },
        },
        {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', enum: ['unavailable'] } },
        },
      ],
    },
  })
  preview(
    @CurrentTenant() actor: TenantContext,
    @Param('objectCode') code: string,
    @Body() body: FilterPreviewBody,
  ) {
    return this.previews.preview(actor, code, body);
  }
}
