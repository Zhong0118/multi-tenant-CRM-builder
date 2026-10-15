import { ZodError } from 'zod';
import { ApiException } from '../../common/errors/api.exception';

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
  objectNames?: Map<string, string>;
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

      const startedAt = new Date().toISOString();
      let parsed: unknown;
      try {
        parsed = tool.inputSchema.parse(input);
      } catch (error) {
        if (error instanceof ZodError) {
          markFailed(
            callbacks,
            {
              callId,
              toolName: tool.name,
              displayName: genericToolDisplayName(tool.name),
              status: 'RUNNING',
              startedAt,
            },
            INVALID_ARGUMENT.code,
            '查询参数格式无效，请按工具输入格式修正后重试。',
          );
          return INVALID_ARGUMENT;
        }
        throw error;
      }

      let begun = false;
      const objectNames = (callbacks.objectNames ??= new Map<string, string>());
      const objectCode =
        isRecord(parsed) && typeof parsed.objectCode === 'string'
          ? parsed.objectCode
          : undefined;
      const displayName = toolDisplayName(
        tool.name,
        parsed,
        objectCode ? objectNames.get(objectCode) : undefined,
      );
      const started: AiToolSummary = {
        callId,
        toolName: tool.name,
        displayName,
        status: 'RUNNING',
        startedAt,
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
        // Learn names only from successful, sanitized, permission-filtered metadata.
        const metadata =
          tool.name === 'list_objects' && Array.isArray(sanitized)
            ? sanitized
            : tool.name === 'describe_object' &&
                isRecord(sanitized) &&
                isRecord(sanitized.object)
              ? [sanitized.object]
              : [];
        for (const item of metadata) {
          if (
            isRecord(item) &&
            typeof item.code === 'string' &&
            typeof item.name === 'string'
          )
            objectNames.set(item.code, item.name);
        }
        const source = AiSourceBuilder.fromTool({
          toolName: tool.name,
          input: parsed,
          result: sanitized,
        });
        if (source) {
          if (source.objectName === source.objectCode) {
            source.objectName =
              objectNames.get(source.objectCode) ?? source.objectName;
          }
          callbacks.sources.push(source);
          callbacks.emit({
            event: 'sources.updated',
            data: { sources: [...callbacks.sources] },
          });
        }
        const completed: AiToolSummary = {
          ...started,
          status: 'COMPLETED',
          displayName: toolDisplayName(
            tool.name,
            parsed,
            objectCode ? objectNames.get(objectCode) : undefined,
          ),
          durationMs: elapsed(startedAt),
          detail: sourceDetail(source),
        };
        upsertSummary(callbacks.toolSummaries, completed);
        callbacks.emit({ event: 'tool.completed', data: completed });
        return sanitized;
      } catch (error) {
        const failure = safeToolFailure(error);
        markFailed(
          callbacks,
          started,
          failure.code,
          failure.code === 'INVALID_TOOL_ARGUMENT'
            ? '查询条件格式不正确，请重新查询。'
            : failure.detail,
        );
        return failure;
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

export function toolDisplayName(
  toolName: string,
  input: unknown,
  objectName?: string,
): string {
  const objectCode =
    isRecord(input) && typeof input.objectCode === 'string' && input.objectCode
      ? input.objectCode
      : undefined;
  if (!objectCode) return genericToolDisplayName(toolName);
  const label = objectName ?? objectCode;
  switch (toolName) {
    case 'describe_object':
      return `查询${label}结构`;
    case 'search_records':
      return `查询${label}记录`;
    case 'get_record':
      return `查询${label}详情`;
    case 'aggregate_records':
      return `统计${label}`;
    case 'list_activities':
      return `查询${label}活动`;
    case 'list_followups':
      return `查询${label}跟进`;
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

function markFailed(
  callbacks: AiToolCallbacks,
  started: AiToolSummary,
  errorCode = 'DATA_UNAVAILABLE',
  detail = '数据暂时不可用，请稍后重新查询。',
): void {
  const failed: AiToolSummary = {
    ...started,
    status: 'FAILED',
    detail,
    errorCode,
    durationMs: elapsed(started.startedAt),
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

function elapsed(startedAt?: string): number {
  return startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : 0;
}

function safeToolFailure(error: unknown): {
  unavailable: true;
  code: string;
  detail?: string;
} {
  if (error instanceof ZodError) return INVALID_ARGUMENT;
  if (error instanceof ApiException) {
    if (
      error.code === 'RECORD_FILTER_INVALID' ||
      error.code === 'VALIDATION_FAILED'
    ) {
      return {
        ...INVALID_ARGUMENT,
        detail:
          '查询参数无效或字段不可用。请仅使用 describe_object 返回的可见字段和选项；单选和多选筛选必须为选项 key 数组，例如 {"stage":["lost"]}，不能传字符串或 eq 对象。其他类型请按工具的 filters 格式重试。',
      };
    }
    if (error.getStatus() === 403) {
      return {
        unavailable: true,
        code: 'ACCESS_RESTRICTED',
        detail: '当前成员无权执行此查询，请勿尝试绕过权限。',
      };
    }
    if (
      [
        'AI_TOOL_BUDGET_EXCEEDED',
        'AI_TOOL_PARALLEL_LIMIT',
        'AI_TOOL_PAYLOAD_LIMIT',
      ].includes(error.code)
    ) {
      return {
        unavailable: true,
        code: error.code,
        detail: '查询预算已达到限制，请根据已有结果总结，并说明未完成的部分。',
      };
    }
  }
  return UNAVAILABLE;
}
