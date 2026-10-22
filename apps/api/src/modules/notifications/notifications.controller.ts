import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  NotificationOkDto,
  NotificationPageDto,
  NotificationsQueryDto,
  NotificationTargetDto,
  ReadAllNotificationsDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('workspaces/:tenantCode/notifications')
@ApiTags('notifications')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.service.list(context, query);
  }
  @Post('read-all')
  @ApiOkResponse({ type: NotificationOkDto })
  readAll(
    @CurrentTenant() context: TenantContext,
    @Body() input: ReadAllNotificationsDto,
  ) {
    return this.service.readAll(context, input.before, input.snapshot);
  }
  @Patch(':id/read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationOkDto })
  read(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.read(context, id);
  }
  @Get(':id/target')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationTargetDto })
  target(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.target(context, id);
  }
}
