import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  ArchiveRecordViewDto,
  CreateRecordViewDto,
  UpdateRecordViewDto,
  RecordViewResponseDto,
  RecordViewListResponseDto,
} from './dto';
import { RecordViewsService } from './record-views.service';

@Controller('workspaces/:tenantCode/objects/:objectCode/record-views')
@ApiTags('record-views')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class RecordViewsController {
  constructor(private readonly views: RecordViewsService) {}

  @Get()
  @ApiOkResponse({ type: RecordViewListResponseDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
  ) {
    return this.views.list(context, code);
  }

  @Get(':viewId')
  @ApiOkResponse({ type: RecordViewResponseDto })
  get(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('viewId', ParseUUIDPipe) id: string,
  ) {
    return this.views.get(context, code, id);
  }

  @Post()
  @ApiCreatedResponse({ type: RecordViewResponseDto })
  create(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Body() dto: CreateRecordViewDto,
  ) {
    return this.views.create(context, code, dto);
  }

  @Patch(':viewId')
  @ApiOkResponse({ type: RecordViewResponseDto })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('viewId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecordViewDto,
  ) {
    return this.views.update(context, code, id, dto);
  }

  @Delete(':viewId')
  @HttpCode(204)
  @ApiBody({ type: ArchiveRecordViewDto, required: false })
  @ApiNoContentResponse()
  archive(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('viewId', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveRecordViewDto,
  ) {
    return this.views.archive(context, code, id, dto?.expectedRevision);
  }
}
