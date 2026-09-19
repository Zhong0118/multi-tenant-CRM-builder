import {
  FakeAiProvider,
  CRITICAL_SEARCH_OBJECT_CODE,
  CRITICAL_SEARCH_OWN_LEADS_MARKER,
  getFakeAiProviderCapturedToolResult,
  resetFakeAiProviderCapture,
} from './providers/fake-ai.provider';
import { VercelOpenAiProvider } from './providers/vercel-openai.provider';
import { createAiProvider } from './ai-provider';
import { sseFrame } from './ai-stream';
import type { AiProviderEvent } from './ai-provider';

jest.mock('ai', () => ({
  streamText: jest.fn(),
  tool: jest.fn((definition: unknown) => definition),
  stepCountIs: jest.fn((count: number) => count),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => (modelKey: string) => ({ modelKey })),
}));

import { streamText } from 'ai';

const streamInput = {
  messages: [{ role: 'user' as const, content: '你好' }],
  system: 'test-system',
  tools: [],
  abortSignal: new AbortController().signal,
};

async function collect(
  stream: AsyncIterable<AiProviderEvent>,
): Promise<AiProviderEvent[]> {
  const events: AiProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('FakeAiProvider', () => {
  afterEach(() => {
    resetFakeAiProviderCapture();
  });

  it('emits TEXT_DELTA 测试回答 then COMPLETED without touching the network', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const provider = new FakeAiProvider();
    const events = await collect(provider.streamTurn(streamInput));
    expect(events).toEqual([
      { type: 'TEXT_DELTA', text: '测试回答' },
      { type: 'COMPLETED' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('requests search_records for critical:search-own-leads using the Critical fixture object code', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const execute = jest.fn().mockResolvedValue({
      items: [{ id: 'owned', title: '自己的线索' }],
    });
    const provider = new FakeAiProvider();
    const events = await collect(
      provider.streamTurn({
        ...streamInput,
        messages: [
          { role: 'user', content: `请查询 ${CRITICAL_SEARCH_OWN_LEADS_MARKER}` },
        ],
        tools: [
          {
            name: 'search_records',
            description: 'search',
            inputSchema: { parse: (value: unknown) => value } as never,
            execute,
          },
        ],
      }),
    );
    expect(CRITICAL_SEARCH_OBJECT_CODE).toBe('leads');
    expect(execute).toHaveBeenCalledWith(
      { objectCode: 'leads', limit: 20 },
      expect.any(String),
    );
    expect(getFakeAiProviderCapturedToolResult()).toEqual({
      items: [{ id: 'owned', title: '自己的线索' }],
    });
    expect(events).toEqual([
      {
        type: 'TOOL_CALL_REQUESTED',
        callId: expect.any(String),
        toolName: 'search_records',
      },
      {
        type: 'TEXT_DELTA',
        text: '已查询你有权访问的销售线索。',
      },
      { type: 'USAGE', inputTokens: 8, outputTokens: 12 },
      { type: 'COMPLETED' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('createAiProvider factory', () => {
  it('accepts FakeAiProvider only when NODE_ENV=test and AI_PROVIDER=fake', () => {
    const provider = createAiProvider({
      nodeEnv: 'test',
      provider: 'fake',
    });
    expect(provider).toBeInstanceOf(FakeAiProvider);
  });

  it('does not silently fall back to fake outside test+fake', () => {
    for (const env of [
      { nodeEnv: 'development', provider: 'fake', model: 'gpt-4.1', apiKey: 'sk' },
      { nodeEnv: 'production', provider: 'fake' },
      { nodeEnv: 'test', provider: 'openai' },
      { nodeEnv: 'development', provider: 'openai' },
    ]) {
      const provider = createAiProvider(env);
      expect(provider).not.toBeInstanceOf(FakeAiProvider);
    }
  });

  it('yields AI_PROVIDER_UNAVAILABLE when the OpenAI key or model is missing', async () => {
    const provider = createAiProvider({
      nodeEnv: 'development',
      provider: 'openai',
      model: '',
      apiKey: '',
    });
    const events = await collect(provider.streamTurn(streamInput));
    expect(events).toEqual([
      { type: 'FAILED', code: 'AI_PROVIDER_UNAVAILABLE' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/sk-|apiKey|raw/i);
  });
});

describe('VercelOpenAiProvider mapping', () => {
  beforeEach(() => {
    (streamText as jest.Mock).mockReset();
  });

  it('maps text-delta, tool-call, and finish; never forwards raw or reasoning payloads', async () => {
    (streamText as jest.Mock).mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', text: 'hidden-chain-of-thought' };
        yield { type: 'raw', rawValue: { apiKey: 'sk-live-secret', body: 'dump' } };
        yield { type: 'file', file: { mediaType: 'image/png' } };
        yield { type: 'source', sourceType: 'url', url: 'https://internal.example' };
        yield { type: 'text-delta', text: '你好' };
        yield { type: 'text-delta', delta: '世界' };
        yield {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'search_records',
          input: { q: 'secret-filter' },
        };
        yield {
          type: 'finish',
          totalUsage: { inputTokens: 11, outputTokens: 7 },
        };
      })(),
    });

    const provider = new VercelOpenAiProvider({
      apiKey: 'sk-test',
      modelKey: 'gpt-4.1-mini',
    });
    const events = await collect(provider.streamTurn(streamInput));
    expect(events).toEqual([
      { type: 'TEXT_DELTA', text: '你好' },
      { type: 'TEXT_DELTA', text: '世界' },
      {
        type: 'TOOL_CALL_REQUESTED',
        callId: 'call_1',
        toolName: 'search_records',
      },
      { type: 'USAGE', inputTokens: 11, outputTokens: 7 },
      { type: 'COMPLETED' },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('hidden-chain-of-thought');
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain('secret-filter');
    expect(serialized).not.toContain('internal.example');
    expect(events.every((event) => !('rawValue' in event))).toBe(true);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen: 4,
        maxOutputTokens: 2000,
      }),
    );
  });

  it('normalizes provider errors to public FAILED codes without raw strings', async () => {
    (streamText as jest.Mock).mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: 'error',
          error: new Error('OpenAI 401 invalid_api_key sk-live-secret'),
        };
      })(),
    });
    const provider = new VercelOpenAiProvider({
      apiKey: 'sk-test',
      modelKey: 'gpt-4.1-mini',
    });
    const events = await collect(provider.streamTurn(streamInput));
    expect(events).toEqual([
      { type: 'FAILED', code: 'AI_PROVIDER_UNAVAILABLE' },
    ]);
    expect(JSON.stringify(events)).not.toContain('sk-live-secret');
    expect(JSON.stringify(events)).not.toContain('invalid_api_key');
  });

  it('maps timeout failures to AI_PROVIDER_TIMEOUT', async () => {
    (streamText as jest.Mock).mockReturnValue({
      fullStream: (async function* () {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        yield { type: 'error', error };
      })(),
    });
    const provider = new VercelOpenAiProvider({
      apiKey: 'sk-test',
      modelKey: 'gpt-4.1-mini',
    });
    const events = await collect(provider.streamTurn(streamInput));
    expect(events).toEqual([{ type: 'FAILED', code: 'AI_PROVIDER_TIMEOUT' }]);
  });
});

describe('sseFrame', () => {
  it('frames AiPublicStreamEvent as event/data SSE', () => {
    expect(
      sseFrame({ event: 'assistant.delta', data: { text: '测试回答' } }),
    ).toBe('event: assistant.delta\ndata: {"text":"测试回答"}\n\n');
  });
});
