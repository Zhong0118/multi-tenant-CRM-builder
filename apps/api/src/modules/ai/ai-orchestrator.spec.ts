import { AiOrchestrator } from './ai-orchestrator';
import type { AiProvider, AiProviderEvent } from './ai-provider';
import type { ConversationService } from './conversation.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AiPublicStreamEvent } from '../../../../../packages/contracts/src/ai/stream';
import type { BeginTurnResult } from './ai.types';

const context: TenantContext = {
  tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  tenantCode: 'demo',
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
  role: 'EMPLOYEE',
};

const begun: BeginTurnResult = {
  conversationId: 'conv-1',
  title: '帮我看看',
  turnId: 'turn-1',
  user: {
    id: 'user-msg',
    status: 'COMPLETED',
    content: '帮我看看本月商机',
    turnId: 'turn-1',
    completedAt: new Date('2026-09-18T10:00:00.000Z'),
  },
  assistant: {
    id: 'asst-msg',
    status: 'GENERATING',
    content: '',
    turnId: 'turn-1',
    toolSummary: [],
    sourceSummary: [],
    providerUsage: { secret: 'must-not-leak' },
    errorCode: null,
    completedAt: null,
  },
};

async function collect(
  stream: AsyncIterable<AiPublicStreamEvent>,
): Promise<AiPublicStreamEvent[]> {
  const events: AiPublicStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function providerWith(
  events: AiProviderEvent[] | ((signal: AbortSignal) => AsyncIterable<AiProviderEvent>),
): AiProvider {
  return {
    providerKey: 'fake',
    modelKey: 'fake-model',
    streamTurn(input) {
      if (typeof events === 'function') return events(input.abortSignal);
      return (async function* () {
        yield* events;
      })();
    },
  };
}

function conversationMock() {
  return {
    beginTurn: jest.fn().mockResolvedValue(begun),
    retryTurn: jest.fn().mockResolvedValue(begun),
    finalizeAssistant: jest.fn().mockResolvedValue(undefined),
    messages: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'user-msg',
          conversationId: 'conv-1',
          turnId: 'turn-1',
          role: 'USER',
          status: 'COMPLETED',
          content: '帮我看看本月商机',
          toolSummary: [],
          sourceSummary: [],
          errorCode: null,
          createdAt: '2026-09-18T10:00:00.000Z',
          completedAt: '2026-09-18T10:00:00.000Z',
        },
        {
          id: 'asst-msg',
          conversationId: 'conv-1',
          turnId: 'turn-1',
          role: 'ASSISTANT',
          status: 'GENERATING',
          content: '',
          toolSummary: [],
          sourceSummary: [],
          errorCode: null,
          createdAt: '2026-09-18T10:00:01.000Z',
          completedAt: null,
        },
      ],
    }),
    list: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<ConversationService>;
}

describe('AiOrchestrator.streamTurn', () => {
  it('calls beginTurn first, then streams public events, then finalizes in a separate call', async () => {
    const conversations = conversationMock();
    const order: string[] = [];
    conversations.beginTurn.mockImplementation(async () => {
      order.push('beginTurn');
      return begun;
    });
    conversations.finalizeAssistant.mockImplementation(async () => {
      order.push('finalizeAssistant');
    });
    const provider = providerWith(async function* () {
      order.push('provider');
      expect(conversations.finalizeAssistant).not.toHaveBeenCalled();
      yield { type: 'TEXT_DELTA', text: '测试回答' };
      yield { type: 'USAGE', inputTokens: 3, outputTokens: 2 };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(conversations, provider);
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '帮我看看本月商机' },
        new AbortController().signal,
      ),
    );
    expect(conversations.beginTurn).toHaveBeenCalledTimes(1);
    expect(conversations.beginTurn.mock.invocationCallOrder[0]).toBeLessThan(
      conversations.finalizeAssistant.mock.invocationCallOrder[0],
    );
    expect(order).toEqual(['beginTurn', 'provider', 'finalizeAssistant']);
    expect(events.map((event) => event.event)).toEqual([
      'conversation.ready',
      'turn.started',
      'assistant.delta',
      'turn.completed',
    ]);
    expect(events[0]).toEqual({
      event: 'conversation.ready',
      data: { conversationId: 'conv-1', title: '帮我看看', turnId: 'turn-1' },
    });
    expect(events.at(-1)).toEqual({
      event: 'turn.completed',
      data: { turnId: 'turn-1', messageId: 'asst-msg' },
    });
    expect(JSON.stringify(events)).not.toContain('must-not-leak');
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        status: 'COMPLETED',
        content: '测试回答',
        usage: expect.objectContaining({
          inputTokens: 3,
          outputTokens: 2,
          providerKey: 'fake',
          modelKey: 'fake-model',
        }),
      }),
    );
    expect(conversations.messages).toHaveBeenCalledWith(context, 'conv-1', {
      limit: 20,
    });
  });

  it('persists CANCELLED with partial text on abort', async () => {
    const conversations = conversationMock();
    const abort = new AbortController();
    const provider = providerWith(async function* (signal) {
      yield { type: 'TEXT_DELTA', text: '半' };
      abort.abort();
      if (signal.aborted) return;
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(conversations, provider);
    const events = await collect(
      await orchestrator.streamTurn(context, { content: '停' }, abort.signal),
    );
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({ status: 'CANCELLED', content: '半' }),
    );
    expect(events.map((event) => event.event)).toContain('turn.cancelled');
    expect(events.find((event) => event.event === 'turn.cancelled')).toEqual({
      event: 'turn.cancelled',
      data: { turnId: 'turn-1', messageId: 'asst-msg' },
    });
  });

  it('persists FAILED with a public code, never a raw provider error string', async () => {
    const conversations = conversationMock();
    const provider = providerWith([
      { type: 'FAILED', code: 'AI_PROVIDER_TIMEOUT' },
    ]);
    const orchestrator = new AiOrchestrator(conversations, provider);
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '问' },
        new AbortController().signal,
      ),
    );
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'AI_PROVIDER_TIMEOUT',
      }),
    );
    expect(events.find((event) => event.event === 'turn.failed')).toEqual({
      event: 'turn.failed',
      data: { turnId: 'turn-1', code: 'AI_PROVIDER_TIMEOUT', messageId: 'asst-msg' },
    });
    expect(JSON.stringify(events)).not.toMatch(/ECONNRESET|sk-|stack/i);
  });

  it('times out a hung provider as FAILED AI_PROVIDER_TIMEOUT, not CANCELLED', async () => {
    const previous = process.env.AI_TIMEOUT_MS;
    process.env.AI_TIMEOUT_MS = '20';
    const conversations = conversationMock();
    const provider = providerWith((signal) => {
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      };
    });
    const orchestrator = new AiOrchestrator(conversations, provider);
    try {
      const events = await collect(
        await orchestrator.streamTurn(
          context,
          { content: '挂起' },
          new AbortController().signal,
        ),
      );
      expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
        context,
        'turn-1',
        expect.objectContaining({
          status: 'FAILED',
          errorCode: 'AI_PROVIDER_TIMEOUT',
        }),
      );
      expect(events.find((event) => event.event === 'turn.failed')).toEqual({
        event: 'turn.failed',
        data: {
          turnId: 'turn-1',
          code: 'AI_PROVIDER_TIMEOUT',
          messageId: 'asst-msg',
        },
      });
      expect(events.map((event) => event.event)).not.toContain('turn.cancelled');
    } finally {
      if (previous === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = previous;
    }
  });

  it('finalizes FAILED AI_TURN_FAILED when messages() throws after beginTurn', async () => {
    const conversations = conversationMock();
    conversations.messages.mockRejectedValue(new Error('db unavailable'));
    const provider = providerWith([{ type: 'COMPLETED' }]);
    const orchestrator = new AiOrchestrator(conversations, provider);
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '问' },
        new AbortController().signal,
      ),
    );
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'AI_TURN_FAILED',
      }),
    );
    expect(events.find((event) => event.event === 'turn.failed')).toEqual({
      event: 'turn.failed',
      data: {
        turnId: 'turn-1',
        code: 'AI_TURN_FAILED',
        messageId: 'asst-msg',
      },
    });
    expect(JSON.stringify(events)).not.toMatch(/db unavailable|stack/i);
  });
});
