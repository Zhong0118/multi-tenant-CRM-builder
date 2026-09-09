import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RecordRelationsService } from './record-relations.service';
export class CreateRecordRelationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  objectCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recordId!: string;
}
export class RecordRelationDto {
  @ApiProperty() id!: string;
  @ApiProperty() recordId!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() title!: string;
}
export class RelationResultDto {
  @ApiProperty() success!: boolean;
}
@Controller(
  'workspaces/:tenantCode/objects/:objectCode/records/:recordId/relations',
)
@ApiTags('record-relations')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode' })
@ApiParam({ name: 'objectCode' })
@ApiParam({ name: 'recordId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class RecordRelationsController {
  constructor(private readonly service: RecordRelationsService) {}
  @Get()
  @ApiOkResponse({ type: RecordRelationDto, isArray: true })
  list(
    @CurrentTenant() ctx: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) id: string,
  ) {
    return this.service.list(ctx, code, id);
  }
  @Post()
  @ApiOkResponse({ type: RelationResultDto })
  add(
    @CurrentTenant() ctx: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) id: string,
    @Body() input: CreateRecordRelationDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.add(ctx, code, id, input, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
  @Delete(':relationId')
  @ApiParam({ name: 'relationId', format: 'uuid' })
  @ApiOkResponse({ type: RelationResultDto })
  remove(
    @CurrentTenant() ctx: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) id: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.remove(ctx, code, id, relationId, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
}
