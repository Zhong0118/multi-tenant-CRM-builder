import type {
  AiProvider,
  AiProviderEvent,
  AiProviderMessage,
  AiProviderTool,
} from '../ai-provider';

export const CRITICAL_SEARCH_OWN_LEADS_MARKER = 'critical:search-own-leads';
export const CRITICAL_SEARCH_OBJECT_CODE = 'leads';

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
    const prompt = input.messages.map((message) => message.content).join('\n');
    if (prompt.includes(CRITICAL_SEARCH_OWN_LEADS_MARKER)) {
      yield* this.searchOwnLeads(input);
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
