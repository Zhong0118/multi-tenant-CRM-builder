import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  BatchUpdateRecordsDto,
  CreateRecordActivityDto,
  CreateRecordDto,
  DeleteRecordResponseDto,
  DeleteRecordDto,
  RecordBatchUpdateResponseDto,
  RecordActivityListQueryDto,
  RecordActivityPageResponseDto,
  RecordActivityResponseDto,
  RecordPageResponseDto,
  RecordListQueryDto,
  RecordResponseDto,
  UpdateRecordDto,
} from './dto';
import { RecordsService } from './records.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller('workspaces/:tenantCode/objects/:objectCode/records')
@ApiTags('records')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiParam({ name: 'objectCode' })
  @ApiOkResponse({ type: RecordPageResponseDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Query() query: RecordListQueryDto,
  ) {
    return this.records.list(context, objectCode, query);
  }

  @Get('export')
  @ApiParam({ name: 'objectCode' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: '当前筛选结果的 CSV 文件。' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Query() query: RecordListQueryDto,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.records.exportCsv(
      context,
      objectCode,
      query,
      requestMeta(request),
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(Buffer.from(file.csv, 'utf8'));
  }

  @Post()
  @ApiCreatedResponse({ type: RecordResponseDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Body() dto: CreateRecordDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.create(context, objectCode, dto, requestMeta(request));
  }

  @Post('batch')
  @ApiOkResponse({ type: RecordBatchUpdateResponseDto })
  batchUpdate(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Body() dto: BatchUpdateRecordsDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.batchUpdate(
      context,
      objectCode,
      dto,
      requestMeta(request),
    );
  }

  @Get(':recordId/activities')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: RecordActivityPageResponseDto })
  listActivities(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Query() query: RecordActivityListQueryDto,
  ) {
    return this.records.listActivities(context, objectCode, recordId, query);
  }

  @Post(':recordId/activities')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiCreatedResponse({ type: RecordActivityResponseDto })
  createActivity(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
    @Body() dto: CreateRecordActivityDto,
    @Req() request: RequestWithId,
  ) {
    return this.records.createActivity(
      context,
      objectCode,
      recordId,
      dto,
      requestMeta(request),
    );
  }

  @Get(':recordId')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: RecordResponseDto })
  detail(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
    @Param('recordId') recordId: string,
  ) {
    return this.records.detail(context, objectCode, recordId);
  }

  @Patch(':recordId')
  @ApiOkResponse({ type: RecordResponseDto })
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
  @ApiOkResponse({ type: DeleteRecordResponseDto })
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
