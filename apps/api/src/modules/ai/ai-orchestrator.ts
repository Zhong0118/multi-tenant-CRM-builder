import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiPublicStreamEvent } from '../../../../../packages/contracts/src/ai/stream';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiProviderMessage,
} from './ai-provider';
import type { BeginTurnResult, PublicAiMessage } from './ai.types';
import { ConversationService } from './conversation.service';
import type { StartAiTurnDto } from './dto/ai-turn.dto';

export const AI_SYSTEM_PROMPT =
  'You are a CRM assistant. Answer only from the current conversation context. Do not invent records, members, or tenant internals. This turn has no tools.\n你是 CRM 助手。只根据当前会话上下文回答，不要编造业务记录或泄露租户内部信息。本轮没有可用工具。';

const PUBLIC_FAILURE_CODES = new Set([
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_TIMEOUT',
  'AI_TURN_FAILED',
  'AI_RATE_LIMITED',
]);

@Injectable()
export class AiOrchestrator {
  private readonly logger = new Logger(AiOrchestrator.name);

  constructor(
    private readonly conversations: ConversationService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  streamTurn(
    context: TenantContext,
    dto: StartAiTurnDto,
    abortSignal: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    return this.run(context, () => this.conversations.beginTurn(context, dto), abortSignal);
  }

  retryTurn(
    context: TenantContext,
    turnId: string,
    abortSignal: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    return this.run(
      context,
      () => this.conversations.retryTurn(context, turnId),
      abortSignal,
    );
  }

  private async *run(
    context: TenantContext,
    begin: () => Promise<BeginTurnResult>,
    abortSignal: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    const startedAt = Date.now();
    const begun = await begin();
    yield {
      event: 'conversation.ready',
      data: {
        conversationId: begun.conversationId,
        title: begun.title,
        turnId: begun.turnId,
      },
    };
    yield { event: 'turn.started', data: { turnId: begun.turnId } };

    const history = await this.conversations.messages(
      context,
      begun.conversationId,
      { limit: 20 },
    );
    const messages = toProviderMessages(history.items, begun);

    let buffer = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let failedCode: string | null = null;
    let completed = false;

    try {
      for await (const event of this.provider.streamTurn({
        messages,
        system: AI_SYSTEM_PROMPT,
        tools: [],
        abortSignal,
      })) {
        if (abortSignal.aborted) break;
        switch (event.type) {
          case 'TEXT_DELTA':
            buffer += event.text;
            yield { event: 'assistant.delta', data: { text: event.text } };
            break;
          case 'USAGE':
            inputTokens = event.inputTokens;
            outputTokens = event.outputTokens;
            break;
          case 'COMPLETED':
            completed = true;
            break;
          case 'FAILED':
            failedCode = publicFailureCode(event.code);
            break;
          default:
            break;
        }
      }
    } catch {
      if (!abortSignal.aborted) failedCode = 'AI_TURN_FAILED';
    }

    const latencyMs = Date.now() - startedAt;
    if (abortSignal.aborted && !completed && !failedCode) {
      await this.conversations.finalizeAssistant(context, begun.turnId, {
        status: 'CANCELLED',
        content: buffer,
      });
      this.logger.log({
        conversationId: begun.conversationId,
        turnId: begun.turnId,
        code: 'CANCELLED',
        latencyMs,
      });
      yield {
        event: 'turn.cancelled',
        data: { turnId: begun.turnId, messageId: begun.assistant.id },
      };
      return;
    }

    if (failedCode) {
      await this.conversations.finalizeAssistant(context, begun.turnId, {
        status: 'FAILED',
        content: buffer,
        errorCode: failedCode,
      });
      this.logger.log({
        conversationId: begun.conversationId,
        turnId: begun.turnId,
        code: failedCode,
        latencyMs,
      });
      yield {
        event: 'turn.failed',
        data: {
          turnId: begun.turnId,
          code: failedCode,
          messageId: begun.assistant.id,
        },
      };
      return;
    }

    if (!completed) {
      const code = 'AI_TURN_FAILED';
      await this.conversations.finalizeAssistant(context, begun.turnId, {
        status: 'FAILED',
        content: buffer,
        errorCode: code,
      });
      this.logger.log({
        conversationId: begun.conversationId,
        turnId: begun.turnId,
        code,
        latencyMs,
      });
      yield {
        event: 'turn.failed',
        data: {
          turnId: begun.turnId,
          code,
          messageId: begun.assistant.id,
        },
      };
      return;
    }

    await this.conversations.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: buffer,
      usage: {
        inputTokens,
        outputTokens,
        providerKey: this.provider.providerKey,
        modelKey: this.provider.modelKey,
      },
    });
    this.logger.log({
      conversationId: begun.conversationId,
      turnId: begun.turnId,
      code: 'COMPLETED',
      latencyMs,
    });
    yield {
      event: 'turn.completed',
      data: { turnId: begun.turnId, messageId: begun.assistant.id },
    };
  }
}

function publicFailureCode(code: string): string {
  return PUBLIC_FAILURE_CODES.has(code) ? code : 'AI_TURN_FAILED';
}

function toProviderMessages(
  items: PublicAiMessage[],
  begun: BeginTurnResult,
): AiProviderMessage[] {
  const mapped = items
    .filter(
      (message) =>
        !(message.turnId === begun.turnId && message.role === 'ASSISTANT'),
    )
    .map((message) => ({
      role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }))
    .filter((message) => message.content.length > 0);
  if (
    mapped.length === 0 ||
    mapped.at(-1)?.role !== 'user' ||
    mapped.at(-1)?.content !== begun.user.content
  ) {
    mapped.push({ role: 'user', content: begun.user.content });
  }
  return mapped;
}
