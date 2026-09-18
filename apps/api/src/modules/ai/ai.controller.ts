import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AiPublicStreamEvent } from '../../../../../packages/contracts/src/ai/stream';

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AiOrchestrator } from './ai-orchestrator';
import { sseFrame } from './ai-stream';
import { ConversationService } from './conversation.service';
import {
  AiConversationListQueryDto,
  AiConversationMessageQueryDto,
  AiConversationPageDto,
  AiConversationResponseDto,
  AiMessagePageDto,
  RenameAiConversationDto,
} from './dto/ai-conversation.dto';
import { StartAiTurnDto } from './dto/ai-turn.dto';

@Controller('workspaces/:tenantCode/ai')
@ApiTags('ai')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class AiController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly orchestrator: AiOrchestrator,
  ) {}

  @Get('conversations')
  @ApiOkResponse({ type: AiConversationPageDto })
  listConversations(
    @CurrentTenant() context: TenantContext,
    @Query() query: AiConversationListQueryDto,
  ) {
    return this.conversations.list(context, query);
  }

  @Get('conversations/:id/messages')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AiMessagePageDto })
  listMessages(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AiConversationMessageQueryDto,
  ) {
    return this.conversations.messages(context, id, query);
  }

  @Patch('conversations/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AiConversationResponseDto })
  renameConversation(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameAiConversationDto,
  ) {
    return this.conversations.rename(context, id, dto.title);
  }

  @Delete('conversations/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @HttpCode(204)
  @ApiNoContentResponse()
  removeConversation(
    @CurrentTenant() context: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.remove(context, id);
  }

  @Post('turns')
  @HttpCode(200)
  @ApiProduces('text/event-stream')
  @Header('Content-Type', 'text/event-stream; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Connection', 'keep-alive')
  @ApiOkResponse({ description: 'AI turn SSE stream' })
  startTurn(
    @CurrentTenant() context: TenantContext,
    @Body() dto: StartAiTurnDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.writeSse(
      request,
      response,
      this.orchestrator.streamTurn(context, dto, this.bindAbort(request).signal),
    );
  }

  @Post('turns/:turnId/retry')
  @HttpCode(200)
  @ApiProduces('text/event-stream')
  @Header('Content-Type', 'text/event-stream; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Connection', 'keep-alive')
  @ApiParam({ name: 'turnId', format: 'uuid' })
  @ApiOkResponse({ description: 'AI turn retry SSE stream' })
  retryTurn(
    @CurrentTenant() context: TenantContext,
    @Param('turnId', ParseUUIDPipe) turnId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.writeSse(
      request,
      response,
      this.orchestrator.retryTurn(
        context,
        turnId,
        this.bindAbort(request).signal,
      ),
    );
  }

  private bindAbort(request: Request): AbortController {
    const abort = new AbortController();
    request.on('close', () => abort.abort());
    return abort;
  }

  private async writeSse(
    request: Request,
    response: Response,
    events: AsyncIterable<AiPublicStreamEvent>,
  ): Promise<void> {
    void request;
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    try {
      for await (const event of events) {
        if (!response.writableEnded) response.write(sseFrame(event));
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}
