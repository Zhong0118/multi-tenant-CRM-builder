import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { CompanyAuditService } from './company-audit.service';
import {
  PlatformAuditPageDto,
  PlatformAuditQueryDto,
} from './dto/platform-operations.dto';

@Controller('workspaces/:tenantCode/audit')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
@ApiTags('company-audit')
@ApiCookieAuth('crm_session')
export class CompanyAuditController {
  constructor(private readonly audit: CompanyAuditService) {}
  @Get()
  @ApiParam({ name: 'tenantCode', type: String })
  @ApiOkResponse({ type: PlatformAuditPageDto })
  list(
    @CurrentTenant() context: TenantContext,
    @Query() query: PlatformAuditQueryDto,
  ) {
    return this.audit.list(context, query);
  }
}
