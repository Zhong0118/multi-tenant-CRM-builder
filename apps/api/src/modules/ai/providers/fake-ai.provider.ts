import type {
  AiProvider,
  AiProviderEvent,
  AiProviderMessage,
  AiProviderTool,
} from '../ai-provider';

export class FakeAiProvider implements AiProvider {
  readonly providerKey = 'fake';
  readonly modelKey = 'fake';

  async *streamTurn(_input: {
    messages: AiProviderMessage[];
    system: string;
    tools: AiProviderTool[];
    abortSignal: AbortSignal;
  }): AsyncIterable<AiProviderEvent> {
    yield { type: 'TEXT_DELTA', text: '测试回答' };
    yield { type: 'COMPLETED' };
  }
}
