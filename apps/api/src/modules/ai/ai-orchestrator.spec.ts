import { z } from 'zod';

import { AiOrchestrator, AI_SYSTEM_PROMPT } from './ai-orchestrator';
import type { AiProvider, AiProviderEvent, AiProviderTool } from './ai-provider';
import type { ConversationService } from './conversation.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AiPublicStreamEvent } from '@crm/contracts';
import type { BeginTurnResult } from './ai.types';
import { AiToolRegistry } from './tool-registry';
import { wrapAiReadTool, type AiToolCallbacks } from './ai-tool-wrapper';

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
  events:
    | AiProviderEvent[]
    | ((
        signal: AbortSignal,
        tools: AiProviderTool[],
      ) => AsyncIterable<AiProviderEvent>),
): AiProvider {
  return {
    providerKey: 'fake',
    modelKey: 'fake-model',
    streamTurn(input) {
      if (typeof events === 'function') {
        return events(input.abortSignal, input.tools);
      }
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
    contextMessages: jest.fn().mockResolvedValue([
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
    ]),
    messages: jest.fn(),
    list: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<ConversationService>;
}

function registryWith(tools: AiProviderTool[]): AiToolRegistry {
  return {
    forActor(_context: TenantContext, callbacks: AiToolCallbacks) {
      return tools.map((tool) => wrapAiReadTool(tool, callbacks));
    },
    names: () => tools.map((tool) => tool.name),
  } as unknown as AiToolRegistry;
}

function searchTool(
  execute: AiProviderTool['execute'],
  name = 'search_records',
): AiProviderTool {
  return {
    name,
    description: name,
    inputSchema: z
      .object({
        objectCode: z.string().optional(),
        limit: z.number().optional(),
      })
      .passthrough(),
    execute,
  };
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
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([]),
    );
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
          toolCalls: 0,
          latencyMs: expect.any(Number),
        }),
        toolSummary: [],
        sourceSummary: [],
        providerKey: 'fake',
        modelKey: 'fake-model',
      }),
    );
    expect(conversations.contextMessages).toHaveBeenCalledWith(context, 'conv-1');
    expect(AI_SYSTEM_PROMPT).toMatch(/untrusted business content/i);
    expect(AI_SYSTEM_PROMPT).toMatch(/provided read tools/);
    expect(AI_SYSTEM_PROMPT).toMatch(/may be incomplete/);
    expect(AI_SYSTEM_PROMPT).toMatch(/hidden or unavailable/);
    expect(AI_SYSTEM_PROMPT).toMatch(/user's language/);
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
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([]),
    );
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
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([]),
    );
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
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([]),
    );
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

  it('finalizes FAILED AI_TURN_FAILED when contextMessages() throws after beginTurn', async () => {
    const conversations = conversationMock();
    conversations.contextMessages.mockRejectedValue(new Error('db unavailable'));
    const provider = providerWith([{ type: 'COMPLETED' }]);
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([]),
    );
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

  it('emits safe tool activity and sources, then persists summaries without raw values', async () => {
    const conversations = conversationMock();
    const provider = providerWith(async function* (_signal, tools) {
      yield {
        type: 'TOOL_CALL_REQUESTED',
        callId: 'call-1',
        toolName: 'search_records',
      };
      await tools[0]!.execute({ objectCode: 'leads', limit: 20 }, 'call-1');
      yield { type: 'TEXT_DELTA', text: '有 1 条线索' };
      yield { type: 'USAGE', inputTokens: 4, outputTokens: 6 };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([
        searchTool(async () => ({
          items: [
            {
              id: 'rec-1',
              title: '自己的线索',
              values: { name: '自己的线索', secret: '内部备注' },
            },
          ],
          total: 1,
        })),
      ]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: 'critical:search-own-leads' },
        new AbortController().signal,
      ),
    );
    expect(events.map((event) => event.event)).toEqual([
      'conversation.ready',
      'turn.started',
      'tool.started',
      'sources.updated',
      'tool.completed',
      'assistant.delta',
      'turn.completed',
    ]);
    expect(events.find((event) => event.event === 'tool.started')?.data).toEqual({
      callId: 'call-1',
      toolName: 'search_records',
      displayName: '查询leads记录',
      status: 'RUNNING',
    });
    expect(JSON.stringify(events)).not.toContain('内部备注');
    expect(JSON.stringify(events)).not.toContain('"values"');
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        status: 'COMPLETED',
        content: '有 1 条线索',
        usage: expect.objectContaining({ toolCalls: 1 }),
        toolSummary: [
          expect.objectContaining({
            callId: 'call-1',
            toolName: 'search_records',
            status: 'COMPLETED',
          }),
        ],
        sourceSummary: [
          expect.objectContaining({
            kind: 'RECORDS',
            objectCode: 'leads',
            count: 1,
          }),
        ],
      }),
    );
  });

  it('still answers after a partial tool failure and records the failed summary', async () => {
    const conversations = conversationMock();
    const provider = providerWith(async function* (_signal, tools) {
      const result = await tools[0]!.execute({ objectCode: 'leads' }, 'call-fail');
      expect(result).toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
      yield { type: 'TEXT_DELTA', text: '部分数据暂不可用。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([
        searchTool(async () => {
          throw new Error('db down');
        }),
      ]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '问' },
        new AbortController().signal,
      ),
    );
    expect(events.map((event) => event.event)).toContain('tool.failed');
    expect(events.map((event) => event.event)).toContain('turn.completed');
    expect(JSON.stringify(events)).not.toContain('db down');
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        status: 'COMPLETED',
        toolSummary: [
          expect.objectContaining({ status: 'FAILED', callId: 'call-fail' }),
        ],
      }),
    );
  });

  it('stops a seventh sequential tool without sending raw results', async () => {
    const conversations = conversationMock();
    const results: unknown[] = [];
    const provider = providerWith(async function* (_signal, tools) {
      for (let index = 0; index < 7; index += 1) {
        results.push(await tools[0]!.execute({ objectCode: 'leads' }, `seq-${index}`));
      }
      yield { type: 'TEXT_DELTA', text: '预算已达上限。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([
        searchTool(async () => ({ items: [{ id: '1', values: { secret: 'x' } }] })),
      ]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '预算' },
        new AbortController().signal,
      ),
    );
    expect(results[4]).toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(results[6]).toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(events.filter((event) => event.event === 'tool.completed')).toHaveLength(4);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(events.map((event) => event.event)).toContain('turn.completed');
  });

  it('stops a fourth concurrent tool without sending raw results', async () => {
    const conversations = conversationMock();
    const provider = providerWith(async function* (_signal, tools) {
      const settled = await Promise.all([
        tools[0]!.execute({ objectCode: 'leads' }, 'p1'),
        tools[0]!.execute({ objectCode: 'leads' }, 'p2'),
        tools[0]!.execute({ objectCode: 'leads' }, 'p3'),
        tools[0]!.execute({ objectCode: 'leads' }, 'p4'),
      ]);
      expect(settled.filter((item) => item && typeof item === 'object' && 'unavailable' in item)).toHaveLength(1);
      expect(settled).toContainEqual({
        unavailable: true,
        code: 'DATA_UNAVAILABLE',
      });
      yield { type: 'TEXT_DELTA', text: '并行已达上限。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([
        searchTool(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ items: [{ id: '1', values: { secret: 'x' } }] }), 20);
            }),
        ),
      ]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '并行' },
        new AbortController().signal,
      ),
    );
    expect(events.filter((event) => event.event === 'tool.started')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('does not start new tools after abort', async () => {
    const conversations = conversationMock();
    const abort = new AbortController();
    const execute = jest.fn(async () => ({ items: [] }));
    const provider = providerWith(async function* (signal, tools) {
      yield { type: 'TEXT_DELTA', text: '半' };
      abort.abort();
      await tools[0]!.execute({ objectCode: 'leads' }, 'after-abort');
      if (signal.aborted) return;
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([searchTool(execute)]),
    );
    const events = await collect(
      await orchestrator.streamTurn(context, { content: '停' }, abort.signal),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('tool.started');
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({ status: 'CANCELLED', content: '半' }),
    );
  });

  it('refuses a fifth provider tool-request round without executing the domain tool', async () => {
    const conversations = conversationMock();
    const execute = jest.fn(async () => ({ items: [] }));
    const results: unknown[] = [];
    const provider = providerWith(async function* (_signal, tools) {
      for (let index = 0; index < 5; index += 1) {
        results.push(
          await tools[0]!.execute({ objectCode: 'leads' }, `round-${index}`),
        );
      }
      yield { type: 'TEXT_DELTA', text: '已达模型轮次上限。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([searchTool(execute)]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '轮次' },
        new AbortController().signal,
      ),
    );
    expect(execute).toHaveBeenCalledTimes(4);
    expect(results[4]).toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(events.filter((event) => event.event === 'tool.completed')).toHaveLength(
      4,
    );
    expect(events.map((event) => event.event)).toContain('turn.completed');
  });
});
