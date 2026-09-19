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

export function wrapAiReadTool(
  tool: AiProviderTool,
  callbacks: AiToolCallbacks,
): AiProviderTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input, callId) {
      if (callbacks.abortSignal.aborted) {
        return { unavailable: true, code: 'DATA_UNAVAILABLE' };
      }
      let begun = false;
      const displayName = toolDisplayName(tool.name, input);
      try {
        callbacks.budget.beginTool();
        begun = true;
        const started: AiToolSummary = {
          callId,
          toolName: tool.name,
          displayName,
          status: 'RUNNING',
        };
        upsertSummary(callbacks.toolSummaries, started);
        callbacks.emit({ event: 'tool.started', data: started });
        const parsed = tool.inputSchema.parse(input);
        const raw = await tool.execute(parsed, callId);
        if (callbacks.abortSignal.aborted) {
          markFailed(callbacks, started);
          return { unavailable: true, code: 'DATA_UNAVAILABLE' };
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
        if (begun) {
          markFailed(callbacks, {
            callId,
            toolName: tool.name,
            displayName,
            status: 'RUNNING',
          });
        }
        return {
          unavailable: true,
          code:
            error instanceof ZodError
              ? 'INVALID_TOOL_ARGUMENT'
              : 'DATA_UNAVAILABLE',
        };
      } finally {
        if (begun) callbacks.budget.endTool();
      }
    },
  };
}

export function toolDisplayName(toolName: string, input: unknown): string {
  const objectCode =
    isRecord(input) && typeof input.objectCode === 'string' && input.objectCode
      ? input.objectCode
      : undefined;
  switch (toolName) {
    case 'list_objects':
      return '查询业务对象';
    case 'describe_object':
      return objectCode ? `查询${objectCode}结构` : '查询对象结构';
    case 'search_records':
      return objectCode ? `查询${objectCode}记录` : '查询记录';
    case 'get_record':
      return objectCode ? `查询${objectCode}详情` : '查询记录';
    case 'aggregate_records':
      return objectCode ? `统计${objectCode}` : '查询统计';
    case 'list_activities':
      return objectCode ? `查询${objectCode}活动` : '查询活动';
    case 'list_followups':
      return objectCode ? `查询${objectCode}跟进` : '查询跟进';
    default:
      return '查询数据';
  }
}

function sourceDetail(source: AiSourceSummary | null): string | undefined {
  if (!source) return undefined;
  if (source.kind === 'RECORDS' || source.kind === 'TIMELINE') {
    return `${source.count} 条`;
  }
  return source.value;
}

function markFailed(
  callbacks: AiToolCallbacks,
  started: AiToolSummary,
): void {
  const failed: AiToolSummary = { ...started, status: 'FAILED', detail: undefined };
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
