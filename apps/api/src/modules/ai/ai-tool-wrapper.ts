import { ZodError } from 'zod';

import type {
  AiPublicStreamEvent,
  AiSourceSummary,
  AiToolSummary,
} from '@crm/contracts';

import type { AiProviderTool } from './ai-provider';
import { AiSanitizer } from './ai-sanitizer';
import { AiSourceBuilder } from './ai-source-builder';
import { AiTurnBudget } from './ai-turn-budget';

export interface AiToolCallbacks {
  emit(event: AiPublicStreamEvent): void;
  budget: AiTurnBudget;
  abortSignal: AbortSignal;
  toolSummaries: AiToolSummary[];
  sources: AiSourceSummary[];
}

export function defaultAiToolCallbacks(): AiToolCallbacks {
  return {
    emit: () => undefined,
    budget: new AiTurnBudget(),
    abortSignal: new AbortController().signal,
    toolSummaries: [],
    sources: [],
  };
}

const UNAVAILABLE = { unavailable: true, code: 'DATA_UNAVAILABLE' } as const;
const INVALID_ARGUMENT = {
  unavailable: true,
  code: 'INVALID_TOOL_ARGUMENT',
} as const;

export function wrapAiReadTool(
  tool: AiProviderTool,
  callbacks: AiToolCallbacks,
): AiProviderTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input, callId) {
      if (callbacks.abortSignal.aborted) return UNAVAILABLE;

      let parsed: unknown;
      try {
        parsed = tool.inputSchema.parse(input);
      } catch (error) {
        if (error instanceof ZodError) {
          markFailed(callbacks, {
            callId,
            toolName: tool.name,
            displayName: genericToolDisplayName(tool.name),
            status: 'RUNNING',
          });
          return INVALID_ARGUMENT;
        }
        throw error;
      }

      let begun = false;
      const displayName = toolDisplayName(tool.name, parsed);
      const started: AiToolSummary = {
        callId,
        toolName: tool.name,
        displayName,
        status: 'RUNNING',
      };
      try {
        callbacks.budget.beginTool();
        begun = true;
        upsertSummary(callbacks.toolSummaries, started);
        callbacks.emit({ event: 'tool.started', data: started });

        const raw = await raceDomainTool(
          tool.execute(parsed, callId),
          callbacks.abortSignal,
        );
        if (raw === abortedSentinel || callbacks.abortSignal.aborted) {
          markFailed(callbacks, started);
          return UNAVAILABLE;
        }

        const sanitized = AiSanitizer.sanitizeToolResult(raw);
        callbacks.budget.addPayload(AiSanitizer.serializedBytes(sanitized));
        const source = AiSourceBuilder.fromTool({
          toolName: tool.name,
          input: parsed,
          result: sanitized,
        });
        if (source) {
          callbacks.sources.push(source);
          callbacks.emit({
            event: 'sources.updated',
            data: { sources: [...callbacks.sources] },
          });
        }
        const completed: AiToolSummary = {
          ...started,
          status: 'COMPLETED',
          detail: sourceDetail(source),
        };
        upsertSummary(callbacks.toolSummaries, completed);
        callbacks.emit({ event: 'tool.completed', data: completed });
        return sanitized;
      } catch (error) {
        if (begun) markFailed(callbacks, started);
        return error instanceof ZodError ? INVALID_ARGUMENT : UNAVAILABLE;
      } finally {
        if (begun) callbacks.budget.endTool();
      }
    },
  };
}

export function genericToolDisplayName(toolName: string): string {
  switch (toolName) {
    case 'list_objects':
      return '查询业务对象';
    case 'describe_object':
      return '查询对象结构';
    case 'search_records':
    case 'get_record':
      return '查询记录';
    case 'aggregate_records':
      return '查询统计';
    case 'list_activities':
      return '查询活动';
    case 'list_followups':
      return '查询跟进';
    default:
      return '查询数据';
  }
}

export function toolDisplayName(toolName: string, input: unknown): string {
  const objectCode =
    isRecord(input) && typeof input.objectCode === 'string' && input.objectCode
      ? input.objectCode
      : undefined;
  if (!objectCode) return genericToolDisplayName(toolName);
  switch (toolName) {
    case 'describe_object':
      return `查询${objectCode}结构`;
    case 'search_records':
      return `查询${objectCode}记录`;
    case 'get_record':
      return `查询${objectCode}详情`;
    case 'aggregate_records':
      return `统计${objectCode}`;
    case 'list_activities':
      return `查询${objectCode}活动`;
    case 'list_followups':
      return `查询${objectCode}跟进`;
    default:
      return genericToolDisplayName(toolName);
  }
}

const abortedSentinel = Symbol('ai-tool-aborted');

async function raceDomainTool(
  domain: Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  let onAbort: (() => void) | undefined;
  const abort = new Promise<typeof abortedSentinel>((resolve) => {
    if (signal.aborted) {
      resolve(abortedSentinel);
      return;
    }
    onAbort = () => resolve(abortedSentinel);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      domain.then(
        (value) => value,
        (error: unknown) => {
          if (signal.aborted) return abortedSentinel;
          throw error;
        },
      ),
      abort,
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    void domain.then(
      () => undefined,
      () => undefined,
    );
  }
}

function sourceDetail(source: AiSourceSummary | null): string | undefined {
  if (!source) return undefined;
  if (source.kind === 'RECORDS' || source.kind === 'TIMELINE') {
    return `${source.count} 条`;
  }
  return source.value;
}

function markFailed(callbacks: AiToolCallbacks, started: AiToolSummary): void {
  const failed: AiToolSummary = {
    ...started,
    status: 'FAILED',
    detail: undefined,
  };
  upsertSummary(callbacks.toolSummaries, failed);
  callbacks.emit({ event: 'tool.failed', data: failed });
}

function upsertSummary(list: AiToolSummary[], summary: AiToolSummary): void {
  const index = list.findIndex((item) => item.callId === summary.callId);
  if (index >= 0) list[index] = summary;
  else list.push(summary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
