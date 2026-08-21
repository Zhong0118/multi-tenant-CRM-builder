import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  CreateRecordDto,
  DeleteRecordDto,
  RecordListQueryDto,
  UpdateRecordDto,
} from './dto';
import { RecordsService } from './records.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller('workspaces/:tenantCode/objects/:objectCode/records')
@ApiTags('records')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiParam({ name: 'tenantCode' })
  @ApiParam({ name: 'objectCode' })
  @ApiOkResponse({ description: '动态记录分页列表' })
  list(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Query() query: RecordListQueryDto,
  ) {
    return this.records.list(context, objectCode, query);
  }

  @Post()
  @ApiCreatedResponse({ description: '已创建动态记录' })
  create(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Body() dto: CreateRecordDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.create(context, objectCode, dto, requestMeta(request));
  }

  @Get(':recordId')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ description: '动态记录详情' })
  detail(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
  ) {
    return this.records.detail(context, objectCode, recordId);
  }

  @Patch(':recordId')
  @ApiOkResponse({ description: '已更新动态记录' })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateRecordDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.update(
      context,
      objectCode,
      recordId,
      dto,
      requestMeta(request),
    );
  }

  @Delete(':recordId')
  @ApiOkResponse({ description: '已软删除动态记录' })
  remove(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Body() dto: DeleteRecordDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.remove(
      context,
      objectCode,
      recordId,
      dto,
      requestMeta(request),
    );
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}
