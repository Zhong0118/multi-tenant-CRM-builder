import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RecordPoolService } from './record-pool.service';
import {
  RecordOwnershipDto,
  RecordOwnershipResponseDto,
  RecordPoolConfigResponseDto,
  UpdateRecordPoolConfigDto,
} from './dto/record-pool.dto';

@Controller('workspaces/:tenantCode/objects/:objectCode')
@ApiTags('records')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class RecordPoolController {
  constructor(private readonly pool: RecordPoolService) {}
  @Get('pool-config')
  @ApiOkResponse({ type: RecordPoolConfigResponseDto })
  getConfig(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
  ) {
    return this.pool.getConfig(context, code);
  }
  @Patch('pool-config')
  @ApiOkResponse({ type: RecordPoolConfigResponseDto })
  updateConfig(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Body() dto: UpdateRecordPoolConfigDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.pool.updateConfig(context, code, dto, {
      requestId: req.requestId ?? 'req_unknown',
      ip: req.ip,
    });
  }
  @Post('records/:recordId/ownership')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: RecordOwnershipResponseDto })
  changeOwnership(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId') id: string,
    @Body() dto: RecordOwnershipDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.pool.changeOwnership(context, code, id, dto, {
      requestId: req.requestId ?? 'req_unknown',
      ip: req.ip,
    });
  }
}
