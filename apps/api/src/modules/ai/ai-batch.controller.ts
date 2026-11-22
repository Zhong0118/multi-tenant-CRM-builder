import {
  Body,
  Controller,
  HttpCode,
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
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AiProposalService } from './ai-proposal.service';
import { ConfirmAiBatchDto, ConfirmAiBatchResultDto } from './dto/ai-batch.dto';

@Controller('workspaces/:tenantCode/ai')
@ApiTags('ai')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class AiBatchController {
  constructor(private readonly proposals: AiProposalService) {}

  @Post('turns/:turnId/proposals/confirm')
  @HttpCode(200)
  @ApiParam({ name: 'turnId', format: 'uuid' })
  @ApiOkResponse({ type: ConfirmAiBatchResultDto })
  confirm(
    @CurrentTenant() actor: TenantContext,
    @Param('turnId', ParseUUIDPipe) turnId: string,
    @Body() dto: ConfirmAiBatchDto,
    @Req() request: Request,
  ) {
    return this.proposals.confirmBatch(actor, turnId, dto.items, {
      requestId: request.headers['x-request-id']?.toString() ?? turnId,
      ip: request.ip,
    });
  }
}
