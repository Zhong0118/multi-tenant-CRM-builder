import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import type {
  AiProvider,
  AiProviderEvent,
  AiProviderMessage,
  AiProviderTool,
} from '../ai-provider';

export class VercelOpenAiProvider implements AiProvider {
  readonly providerKey: 'openai' | 'openai-compatible';
  readonly modelKey: string;
  private readonly apiKey: string;
  private readonly baseURL?: string;

  constructor(input: { apiKey: string; modelKey: string; baseURL?: string }) {
    this.apiKey = input.apiKey;
    this.modelKey = input.modelKey;
    this.baseURL = input.baseURL?.trim() || undefined;
    this.providerKey = this.baseURL ? 'openai-compatible' : 'openai';
  }

  async *streamTurn(input: {
    messages: AiProviderMessage[];
    system: string;
    tools: AiProviderTool[];
    abortSignal: AbortSignal;
  }): AsyncIterable<AiProviderEvent> {
    try {
      const openai = createOpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
      const result = streamText({
        model: openai(this.modelKey),
        system: input.system,
        messages: input.messages,
        tools: Object.fromEntries(
          input.tools.map((entry) => [
            entry.name,
            tool({
              description: entry.description,
              inputSchema: entry.inputSchema,
              execute: async (args, options) =>
                entry.execute(args, options.toolCallId),
            }),
          ]),
        ),
        stopWhen: stepCountIs(4),
        maxOutputTokens: 2000,
        abortSignal: input.abortSignal,
        providerOptions: {
          openai: { store: false },
        },
      });

      for await (const part of result.fullStream) {
        if (input.abortSignal.aborted) return;
        switch (part.type) {
          case 'text-delta': {
            const text = textFromDelta(part);
            if (text) yield { type: 'TEXT_DELTA', text };
            break;
          }
          case 'tool-call': {
            yield {
              type: 'TOOL_CALL_REQUESTED',
              callId: part.toolCallId,
              toolName: String(part.toolName),
            };
            break;
          }
          case 'finish': {
            const usage =
              'totalUsage' in part && part.totalUsage
                ? part.totalUsage
                : 'usage' in part
                  ? (
                      part as {
                        usage?: { inputTokens?: number; outputTokens?: number };
                      }
                    ).usage
                  : undefined;
            yield {
              type: 'USAGE',
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
            };
            yield { type: 'COMPLETED' };
            break;
          }
          case 'error': {
            yield {
              type: 'FAILED',
              code: normalizeProviderFailure(part.error),
            };
            return;
          }
          default:
            break;
        }
      }
    } catch (error) {
      if (input.abortSignal.aborted) return;
      yield { type: 'FAILED', code: normalizeProviderFailure(error) };
    }
  }
}

function textFromDelta(part: { text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string' && part.text.length > 0) return part.text;
  if (typeof part.delta === 'string' && part.delta.length > 0) return part.delta;
  return '';
}

function normalizeProviderFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const haystack = `${name} ${message}`.toLowerCase();
  if (
    name === 'TimeoutError' ||
    haystack.includes('timeout') ||
    haystack.includes('timed out')
  ) {
    return 'AI_PROVIDER_TIMEOUT';
  }
  return 'AI_PROVIDER_UNAVAILABLE';
}
