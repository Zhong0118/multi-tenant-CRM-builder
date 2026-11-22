import { simulateAssistant } from './fake-assistant';
import type { FilterProviderInput } from '../filter-generation';
import type { CommunicationProviderInput } from '../communication-output';
import type {
  AiProvider,
  AiProviderEvent,
  AiProviderMessage,
  AiProviderTool,
} from '../ai-provider';

export const CRITICAL_SEARCH_OWN_LEADS_MARKER = 'critical:search-own-leads';
export const CRITICAL_SEARCH_OBJECT_CODE = 'leads';
const PROPOSE_MARKER =
  /critical:propose-change:(UPDATE_RECORD|CREATE_FOLLOW_UP|ADD_ACTIVITY_NOTE):([0-9a-f-]{36})(?::(HIDDEN|READ_ONLY))?/;

let capturedToolResult: unknown;

export function resetFakeAiProviderCapture(): void {
  capturedToolResult = undefined;
}

export function getFakeAiProviderCapturedToolResult(): unknown {
  return capturedToolResult;
}

// Local scripted provider for deterministic integration and browser testing.
export class FakeAiProvider implements AiProvider {
  readonly providerKey = 'fake';
  readonly modelKey = 'fake';

  generateFilter(input: FilterProviderInput, signal: AbortSignal) {
    signal.throwIfAborted();
    return Promise.resolve(this.demoFilter(input));
  }

  private demoFilter(input: FilterProviderInput) {
    // Fixed demo conversations only. All other requests explicitly abstain.
    const own = { fieldKey: '$owner', operator: 'in', value: ['$me'] };
    const rule = (conditions: unknown[]) => ({
      version: 1,
      match: 'all',
      conditions,
    });
    const stage = input.fields.find((f) => f.label === '阶段');
    const amount = input.fields.find(
      (f) =>
        ['金额', '预计金额'].includes(f.label) &&
        ['NUMBER', 'MONEY'].includes(f.type),
    );
    const over100k = amount && {
      fieldKey: amount.fieldKey,
      operator: 'gt',
      value: amount.type === 'MONEY' ? '100000' : 100000,
    };
    const stages = stage?.options
      ?.filter((o) => ['报价', '谈判'].includes(o.label))
      .map((o) => o.key);
    switch (input.text.trim()) {
      case '找我负责的、报价或谈判中、预计金额超过 10 万的客户':
        if (stages?.length === 2 && stage && over100k)
          return {
            rules: [
              rule([
                own,
                { fieldKey: stage.fieldKey, operator: 'in', value: stages },
                over100k,
              ]),
            ],
          };
        break;
      case '找金额超过 10 万的商机':
        if (over100k) return { rules: [rule([over100k])] };
        break;
      case '找我负责的、金额超过 10 万的客户':
        if (over100k)
          return {
            rules: [rule([own, over100k])],
          };
        break;
      case '再加上金额大于 10 万':
        if (over100k && input.currentRule.match === 'all')
          return {
            rules: [rule([...input.currentRule.conditions, over100k])],
          };
        break;
      case '找值得优先跟进的客户':
        if (stage && stages?.length === 2)
          return {
            rules: stages.map((k) =>
              rule([{ fieldKey: stage.fieldKey, operator: 'in', value: [k] }]),
            ),
          };
        break;
      case '跟进到期':
      case '查看今天待跟进的客户':
        return {
          rules: [
            rule([
              {
                fieldKey: '$followUp',
                operator: 'dueThroughToday',
                value: { assignee: '$me' },
              },
            ]),
          ],
        };
      case '负责人是我':
      case '只看我负责的客户':
      case '换成我负责的客户':
        return { rules: [rule([own])] };
      default: {
        const field = input.fields.find(
          (f) =>
            f.label + '有值' === input.text && f.operators.includes('notEmpty'),
        );
        if (field)
          return {
            rules: [
              rule([
                { fieldKey: field.fieldKey, operator: 'notEmpty', value: null },
              ]),
            ],
          };
      }
    }
    return { rules: [] };
  }

  generateCommunication(
    { text, fields }: CommunicationProviderInput,
    abortSignal: AbortSignal,
  ): Promise<unknown> {
    abortSignal.throwIfAborted();
    if (text.includes('模拟服务不可用'))
      return Promise.reject(new Error('Provider unavailable'));
    const followUpClause = text
      .split(/[。；;！!\n]/u)
      .find((part) => /联系|回访|跟进|致电|拜访/u.test(part));
    const fieldChanges = text.split(/[，,。；;！!\n]/u).flatMap((part) => {
      const evidence = part.trim();
      const pair = /^(.+?)[：:=]\s*(.+)$/u.exec(evidence);
      if (!pair) return [];
      const field = fields.find(
        (f) => f.label === pair[1].trim() || f.fieldKey === pair[1].trim(),
      );
      if (!field) return [];
      const raw = pair[2].trim();
      const option = field.options?.find(
        (option) => option.label === raw || option.key === raw,
      );
      const value = option
        ? field.type === 'MULTI_SELECT'
          ? [option.key]
          : option.key
        : field.type === 'NUMBER'
          ? Number(raw)
          : raw;
      return [{ fieldKey: field.fieldKey, value, evidence }];
    });
    return Promise.resolve({
      note: text.trim(),
      followUp: followUpClause
        ? {
            title: '联系客户',
            // The local demo has one scripted appointment. Other simulated tasks have no date.
            dateExpression: followUpClause.includes('下周再联系')
              ? { kind: 'weekday', week: 'next', weekday: 1, time: null }
              : { kind: 'unknown', time: null },
            evidence: followUpClause.trim(),
          }
        : null,
      fieldChanges,
    });
  }

  async *streamTurn(input: {
    messages: AiProviderMessage[];
    system: string;
    tools: AiProviderTool[];
    abortSignal: AbortSignal;
  }): AsyncIterable<AiProviderEvent> {
    const last = input.messages.at(-1);
    const prompt = last?.role === 'user' ? last.content : '';
    if (prompt.includes(CRITICAL_SEARCH_OWN_LEADS_MARKER)) {
      yield* this.searchOwnLeads(input);
      return;
    }
    if (prompt.includes('critical:provider-secret-failure')) {
      yield { type: 'FAILED', code: 'provider-raw-secret' };
      return;
    }
    const proposal = prompt.match(PROPOSE_MARKER);
    if (proposal) {
      const [, operationType, recordId, fieldAccess] = proposal;
      const callId = 'fake-propose-change';
      const tool = input.tools.find((entry) => entry.name === 'propose_change');
      if (!tool || input.abortSignal.aborted) return;
      await input.tools
        .find((t) => t.name === 'get_record')
        ?.execute({ objectCode: 'leads', recordId }, 'lookup-critical-target');
      const candidate =
        operationType === 'UPDATE_RECORD'
          ? {
              operationType,
              objectCode: 'leads',
              recordId,
              values: {
                [fieldAccess === 'HIDDEN'
                  ? 'secret'
                  : fieldAccess === 'READ_ONLY'
                    ? 'reviewCode'
                    : 'name']:
                  fieldAccess === 'READ_ONLY' ? 'changed' : 'HTTP confirmed',
              },
            }
          : operationType === 'CREATE_FOLLOW_UP'
            ? {
                operationType,
                objectCode: 'leads',
                recordId,
                title: 'HTTP follow-up',
                dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              }
            : {
                operationType,
                objectCode: 'leads',
                recordId,
                content: 'HTTP note',
              };
      await tool.execute(candidate, callId);
      yield { type: 'USAGE', inputTokens: 8, outputTokens: 12 };
      yield { type: 'COMPLETED' };
      return;
    }
    yield* simulateAssistant(input);
  }

  private async *searchOwnLeads(input: {
    tools: AiProviderTool[];
    abortSignal: AbortSignal;
  }): AsyncIterable<AiProviderEvent> {
    const callId = 'fake-search-own-leads';
    yield {
      type: 'TOOL_CALL_REQUESTED',
      callId,
      toolName: 'search_records',
    };
    if (input.abortSignal.aborted) return;
    const tool = input.tools.find((entry) => entry.name === 'search_records');
    if (tool) {
      capturedToolResult = await tool.execute(
        { objectCode: CRITICAL_SEARCH_OBJECT_CODE, limit: 20 },
        callId,
      );
    }
    if (input.abortSignal.aborted) return;
    yield { type: 'TEXT_DELTA', text: '已查询你有权访问的销售线索。' };
    yield { type: 'USAGE', inputTokens: 8, outputTokens: 12 };
    yield { type: 'COMPLETED' };
  }
}
