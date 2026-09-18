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

const DEFAULT_AI_TIMEOUT_MS = 45_000;

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

  async streamTurn(
    context: TenantContext,
    dto: StartAiTurnDto,
    abortSignal: AbortSignal,
  ): Promise<AsyncIterable<AiPublicStreamEvent>> {
    const begun = await this.conversations.beginTurn(context, dto);
    return this.continueTurn(context, begun, abortSignal);
  }

  async retryTurn(
    context: TenantContext,
    turnId: string,
    abortSignal: AbortSignal,
  ): Promise<AsyncIterable<AiPublicStreamEvent>> {
    const begun = await this.conversations.retryTurn(context, turnId);
    return this.continueTurn(context, begun, abortSignal);
  }

  private async *continueTurn(
    context: TenantContext,
    begun: BeginTurnResult,
    clientAbort: AbortSignal,
  ): AsyncIterable<AiPublicStreamEvent> {
    const startedAt = Date.now();
    yield {
      event: 'conversation.ready',
      data: {
        conversationId: begun.conversationId,
        title: begun.title,
        turnId: begun.turnId,
      },
    };
    yield { event: 'turn.started', data: { turnId: begun.turnId } };

    let buffer = '';
    try {
      const history = await this.conversations.messages(
        context,
        begun.conversationId,
        { limit: 20 },
      );
      const messages = toProviderMessages(history.items, begun);
      const timeout = AbortSignal.timeout(timeoutMs());
      const abortSignal = AbortSignal.any([clientAbort, timeout]);

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let failedCode: string | null = null;
      let completed = false;

      try {
        for await (const event of iterateUntilAborted(
          this.provider.streamTurn({
            messages,
            system: AI_SYSTEM_PROMPT,
            tools: [],
            abortSignal,
          }),
          abortSignal,
        )) {
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
      if (clientAbort.aborted && !completed && !failedCode) {
        await this.finish(context, begun, latencyMs, {
          status: 'CANCELLED',
          content: buffer,
        });
        yield {
          event: 'turn.cancelled',
          data: { turnId: begun.turnId, messageId: begun.assistant.id },
        };
        return;
      }

      if (timeout.aborted && !completed && !failedCode) {
        failedCode = 'AI_PROVIDER_TIMEOUT';
      }

      if (failedCode) {
        await this.finish(context, begun, latencyMs, {
          status: 'FAILED',
          content: buffer,
          errorCode: failedCode,
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
        await this.finish(context, begun, latencyMs, {
          status: 'FAILED',
          content: buffer,
          errorCode: code,
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

      await this.finish(context, begun, latencyMs, {
        status: 'COMPLETED',
        content: buffer,
        usage: {
          inputTokens,
          outputTokens,
          providerKey: this.provider.providerKey,
          modelKey: this.provider.modelKey,
        },
      });
      yield {
        event: 'turn.completed',
        data: { turnId: begun.turnId, messageId: begun.assistant.id },
      };
    } catch {
      const latencyMs = Date.now() - startedAt;
      await this.finish(context, begun, latencyMs, {
        status: 'FAILED',
        content: buffer,
        errorCode: 'AI_TURN_FAILED',
      });
      yield {
        event: 'turn.failed',
        data: {
          turnId: begun.turnId,
          code: 'AI_TURN_FAILED',
          messageId: begun.assistant.id,
        },
      };
    }
  }

  private async finish(
    context: TenantContext,
    begun: BeginTurnResult,
    latencyMs: number,
    outcome: {
      status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      content: string;
      usage?: Record<string, unknown>;
      errorCode?: string | null;
    },
  ): Promise<void> {
    await this.conversations.finalizeAssistant(context, begun.turnId, outcome);
    this.logger.log({
      conversationId: begun.conversationId,
      turnId: begun.turnId,
      code: outcome.errorCode ?? outcome.status,
      latencyMs,
    });
  }
}

async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (!signal.aborted) {
      const next = await Promise.race([
        iterator.next(),
        aborted(signal).then(() => undefined),
      ]);
      if (!next || next.done) break;
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function timeoutMs(): number {
  const raw = process.env.AI_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_AI_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS;
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
