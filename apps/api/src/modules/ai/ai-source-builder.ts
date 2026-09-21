import type { AiSourceSummary } from '@crm/contracts';

export class AiSourceBuilder {
  static fromTool(input: {
    toolName: string;
    input: unknown;
    result: unknown;
  }): AiSourceSummary | null {
    const objectCode = objectCodeFrom(input.input, input.result);
    const objectName = publishedObjectName(input.result) ?? objectCode;
    switch (input.toolName) {
      case 'search_records':
      case 'get_record':
        return {
          kind: 'RECORDS',
          objectCode: objectCode ?? 'records',
          objectName: objectName ?? '记录',
          count: recordCount(input.toolName, input.result),
        };
      case 'aggregate_records':
        return {
          kind: 'AGGREGATE',
          objectCode: objectCode ?? 'records',
          objectName: objectName ?? '统计',
          label: aggregateLabel(input.input),
          value: aggregateValue(input.result),
        };
      case 'list_activities':
        return {
          kind: 'TIMELINE',
          objectCode: objectCode ?? 'records',
          objectName: objectName ?? '活动',
          recordId: recordIdFrom(input.input),
          count: listCount(input.result),
        };
      case 'list_followups':
        return {
          kind: 'TIMELINE',
          objectCode: objectCode ?? 'followups',
          objectName: objectName ?? '跟进',
          count: listCount(input.result),
        };
      default:
        return null;
    }
  }
}

function objectCodeFrom(input: unknown, result: unknown): string | undefined {
  if (isRecord(input) && typeof input.objectCode === 'string') {
    return input.objectCode;
  }
  if (Array.isArray(result) && isRecord(result[0]) && typeof result[0].objectCode === 'string') {
    return result[0].objectCode;
  }
  return undefined;
}

function recordIdFrom(input: unknown): string | undefined {
  return isRecord(input) && typeof input.recordId === 'string'
    ? input.recordId
    : undefined;
}

function recordCount(toolName: string, result: unknown): number {
  if (toolName === 'get_record') return result ? 1 : 0;
  return listCount(result);
}

function listCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (isRecord(result) && Array.isArray(result.items)) return result.items.length;
  if (isRecord(result) && typeof result.total === 'number') return result.total;
  return 0;
}

function aggregateLabel(input: unknown): string {
  if (!isRecord(input) || typeof input.aggregation !== 'string') return '统计';
  if (input.aggregation === 'SUM') return '合计';
  if (input.aggregation === 'AVG') return '平均';
  return '计数';
}

function aggregateValue(result: unknown): string {
  if (isRecord(result) && typeof result.value === 'string') return result.value;
  if (isRecord(result) && typeof result.value === 'number') return String(result.value);
  return '0';
}

function publishedObjectName(result: unknown): string | undefined {
  if (Array.isArray(result)) {
    return publishedObjectName(result[0]);
  }
  if (!isRecord(result)) return undefined;
  if (typeof result.objectName === 'string' && result.objectName) {
    return result.objectName;
  }
  if (isRecord(result.object) && typeof result.object.name === 'string' && result.object.name) {
    return result.object.name;
  }
  if (Array.isArray(result.items)) {
    return publishedObjectName(result.items[0]);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
