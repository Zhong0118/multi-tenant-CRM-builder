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

// Fake is 1-round by construction: at most one tool execute, then COMPLETED.
// Production OpenAI uses stopWhen: stepCountIs(4). Tool counts are 6/3, not model rounds.
export class FakeAiProvider implements AiProvider {
  readonly providerKey = 'fake';
  readonly modelKey = 'fake';

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
    yield { type: 'TEXT_DELTA', text: '测试回答' };
    yield { type: 'COMPLETED' };
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
