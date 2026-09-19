import type { AiSourceSummary } from '@crm/contracts';

const OBJECT_NAMES: Record<string, string> = {
  leads: '销售线索',
  customers: '客户',
  opportunities: '跟单商机',
  activities: '跟进活动',
  contracts: '合同',
  payments: '回款',
};

export class AiSourceBuilder {
  static fromTool(input: {
    toolName: string;
    input: unknown;
    result: unknown;
  }): AiSourceSummary | null {
    const objectCode = objectCodeFrom(input.input, input.result);
    switch (input.toolName) {
      case 'search_records':
      case 'get_record':
        return {
          kind: 'RECORDS',
          objectCode: objectCode ?? 'records',
          objectName: objectName(objectCode),
          count: recordCount(input.toolName, input.result),
        };
      case 'aggregate_records':
        return {
          kind: 'AGGREGATE',
          objectCode: objectCode ?? 'records',
          objectName: objectName(objectCode),
          label: aggregateLabel(input.input),
          value: aggregateValue(input.result),
        };
      case 'list_activities':
        return {
          kind: 'TIMELINE',
          objectCode: objectCode ?? 'records',
          objectName: objectName(objectCode),
          recordId: recordIdFrom(input.input),
          count: listCount(input.result),
        };
      case 'list_followups':
        return {
          kind: 'TIMELINE',
          objectCode: objectCode ?? 'followups',
          objectName: objectName(objectCode) === '业务对象' ? '待办跟进' : objectName(objectCode),
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

function objectName(objectCode: string | undefined): string {
  if (!objectCode) return '业务对象';
  return OBJECT_NAMES[objectCode] ?? objectCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
