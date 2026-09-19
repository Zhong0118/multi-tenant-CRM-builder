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

const SHORT_OBJECT_NAMES: Record<string, string> = {
  leads: '销售线索',
  customers: '客户',
  opportunities: '商机',
  activities: '跟进活动',
  contracts: '合同',
  payments: '回款',
};

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
          const failed: AiToolSummary = {
            callId,
            toolName: tool.name,
            displayName,
            status: 'FAILED',
          };
          upsertSummary(callbacks.toolSummaries, failed);
          callbacks.emit({ event: 'tool.failed', data: failed });
        }
        void error;
        return { unavailable: true, code: 'DATA_UNAVAILABLE' };
      } finally {
        if (begun) callbacks.budget.endTool();
      }
    },
  };
}

export function toolDisplayName(toolName: string, input: unknown): string {
  const objectCode =
    isRecord(input) && typeof input.objectCode === 'string'
      ? input.objectCode
      : undefined;
  const objectLabel = objectCode
    ? (SHORT_OBJECT_NAMES[objectCode] ?? objectCode)
    : '业务';
  switch (toolName) {
    case 'list_objects':
      return '查询业务对象';
    case 'describe_object':
      return '查询对象结构';
    case 'search_records':
      return `查询${objectLabel}记录`;
    case 'get_record':
      return `查询${objectLabel}详情`;
    case 'aggregate_records':
      return `统计${objectLabel}`;
    case 'list_activities':
      return '查询相关跟进';
    case 'list_followups':
      return '查询待办跟进';
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

function upsertSummary(list: AiToolSummary[], summary: AiToolSummary): void {
  const index = list.findIndex((item) => item.callId === summary.callId);
  if (index >= 0) list[index] = summary;
  else list.push(summary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
