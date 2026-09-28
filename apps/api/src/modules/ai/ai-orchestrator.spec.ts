import { z } from 'zod';

import {
  AiOrchestrator,
  AI_SYSTEM_PROMPT,
  mergeProviderAndPublicEvents,
} from './ai-orchestrator';
import { AiPublicEventQueue } from './ai-public-event-queue';
import type {
  AiProvider,
  AiProviderEvent,
  AiProviderTool,
} from './ai-provider';
import type { ConversationService } from './conversation.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AiPublicStreamEvent } from '@crm/contracts';
import type { BeginTurnResult } from './ai.types';
import { AiToolRegistry } from './tool-registry';
import { wrapAiReadTool, type AiToolCallbacks } from './ai-tool-wrapper';
import type { AiProposalService } from './ai-proposal.service';
import type { AiProposalView } from './ai-operation.types';
import { ProposalCollector } from './tools/propose-change.tool';

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

describe('AiOrchestrator proposal candidate lifecycle', () => {
  it('keeps distinct provider calls invalidated', async () => {
    const collector = new ProposalCollector();
    await collector.tool.execute(
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: context.tenantId,
        content: 'one',
      },
      'same-call',
    );
    await collector.tool.execute(
      {
        operationType: 'ADD_ACTIVITY_NOTE',
        objectCode: 'leads',
        recordId: context.tenantId,
        content: 'two',
      },
      'second-call',
    );
    expect(collector.invalidated).toBe(true);
    expect(collector.candidate).toBeNull();
  });

  const candidate = {
    operationType: 'ADD_ACTIVITY_NOTE',
    objectCode: 'leads',
    recordId: context.tenantId,
    content: 'safe note',
  };
  const proposal: AiProposalView = {
    proposalId: 'proposal-1',
    operation: 'ADD_ACTIVITY_NOTE',
    title: '添加备注',
    targetSummary: 'Lead',
    changes: [{ label: 'NOTE', after: 'safe note' }],
    validationWarnings: [],
    status: 'PROPOSED',
    expiresAt: '2026-09-24T12:15:00.000Z',
    failureCode: null,
    result: null,
    auditId: null,
  };
  function proposalMock() {
    return {
      completeWithProposal: jest.fn().mockResolvedValue(proposal),
    } as unknown as jest.Mocked<AiProposalService>;
  }
  it('does not persist a proposal when client aborts after provider completion', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const abort = new AbortController();
    const provider = providerWith(async function* (_signal, tools) {
      await tools
        .find((tool) => tool.name === 'propose_change')!
        .execute(candidate, 'first');
      yield { type: 'COMPLETED' };
      abort.abort();
      await new Promise((resolve) => setImmediate(resolve));
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, abort.signal),
    );
    expect(proposals.completeWithProposal).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
  });

  it('keeps a committed proposal completed when abort arrives before persistence resolves', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const abort = new AbortController();
    let assistantStatus = 'GENERATING';
    let operationStatus = 'PROPOSED';
    conversations.finalizeAssistant.mockImplementation(async (_context, _turnId, outcome) => {
      assistantStatus = outcome.status;
    });
    proposals.completeWithProposal.mockImplementation(() => {
      assistantStatus = 'COMPLETED';
      operationStatus = 'PROPOSED';
      const committed = Promise.resolve(proposal);
      committed.then(() => abort.abort());
      return committed;
    });
    const provider = providerWith(async function* (_signal, tools) {
      await tools.find((tool) => tool.name === 'propose_change')!.execute(candidate, 'first');
      yield { type: 'COMPLETED' };
    });
    const events = await collect(await new AiOrchestrator(conversations, provider, registryWith([]), proposals).streamTurn(context, { content: 'note' }, abort.signal));
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
    expect(events.map((event) => event.event)).toContain('turn.completed');
    expect(events.map((event) => event.event)).not.toContain('turn.cancelled');
    expect(conversations.finalizeAssistant).not.toHaveBeenCalled();
    expect(proposals.completeWithProposal).toHaveBeenCalledTimes(1);
    expect(assistantStatus).toBe('COMPLETED');
    expect(operationStatus).toBe('PROPOSED');
  });

  it('fails cleanly when persistence outlives the provider timeout', async () => {
    const previous = process.env.AI_TIMEOUT_MS;
    process.env.AI_TIMEOUT_MS = '10';
    const conversations = conversationMock();
    const proposals = proposalMock();
    proposals.completeWithProposal.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('persistence timeout');
    });
    const provider = providerWith(async function* (_signal, tools) {
      await tools
        .find((tool) => tool.name === 'propose_change')!
        .execute(candidate, 'first');
      yield { type: 'COMPLETED' };
    });
    try {
      const events = await collect(
        await new AiOrchestrator(
          conversations,
          provider,
          registryWith([]),
          proposals,
        ).streamTurn(
          context,
          { content: 'note' },
          new AbortController().signal,
        ),
      );
      expect(events.map((event) => event.event)).not.toContain(
        'proposal.ready',
      );
      expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
        context,
        begun.turnId,
        expect.objectContaining({ status: 'FAILED' }),
      );
    } finally {
      if (previous === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = previous;
    }
  });

  it('publishes a safe ready card only after atomic completion and never calls business commands', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const provider = providerWith(async function* (_signal, tools) {
      const write = tools.find((tool) => tool.name === 'propose_change');
      expect(write).toBeDefined();
      const ack = await write!.execute(candidate, 'proposal-call');
      expect(JSON.stringify(ack)).not.toContain('safe note');
      expect(JSON.stringify(ack)).not.toContain('Lead');
      yield { type: 'COMPLETED' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(proposals.completeWithProposal).toHaveBeenCalledWith(
      context,
      begun.turnId,
      candidate,
      begun.user.content,
      expect.objectContaining({ status: 'COMPLETED' }),
      expect.any(Function),
    );
    expect(conversations.finalizeAssistant).not.toHaveBeenCalled();
    expect(events.filter((event) => event.event === 'proposal.ready')).toEqual([
      { event: 'proposal.ready', data: { turnId: begun.turnId, proposal } },
    ]);
    expect(events.at(-1)?.event).toBe('turn.completed');
  });
  it('invalidates both candidates after a second call and never publishes ready', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const provider = providerWith(async function* (_signal, tools) {
      const write = tools.find((tool) => tool.name === 'propose_change')!;
      await write.execute(candidate, 'first');
      const rejected = await write.execute(
        { ...candidate, content: 'second note' },
        'second',
      );
      expect(JSON.stringify(rejected)).not.toContain('second note');
      yield { type: 'COMPLETED' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(proposals.completeWithProposal).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
    expect(events.map((event) => event.event)).toContain('turn.failed');
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      begun.turnId,
      expect.objectContaining({ status: 'FAILED' }),
    );
  });
  it('invalidates the first candidate when a second provider call has invalid override arguments', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const provider = providerWith(async function* (_signal, tools) {
      const write = tools.find((tool) => tool.name === 'propose_change')!;
      yield {
        type: 'TOOL_CALL_REQUESTED',
        callId: 'first',
        toolName: 'propose_change',
      };
      await write.execute(candidate, 'first');
      yield {
        type: 'TOOL_CALL_REQUESTED',
        callId: 'second',
        toolName: 'propose_change',
      };
      expect(
        write.inputSchema.safeParse({ ...candidate, tenantId: 'attacker' })
          .success,
      ).toBe(false);
      yield { type: 'COMPLETED' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(proposals.completeWithProposal).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
  });
  it('rejects actor overrides at the provider schema without persisting a proposal', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const provider = providerWith(async function* (_signal, tools) {
      const write = tools.find((tool) => tool.name === 'propose_change')!;
      expect(
        write.inputSchema.safeParse({ ...candidate, tenantId: 'attacker' })
          .success,
      ).toBe(false);
      yield { type: 'COMPLETED' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(proposals.completeWithProposal).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
  });
  it('discards a candidate if the provider fails after calling the tool', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    const provider = providerWith(async function* (_signal, tools) {
      await tools
        .find((tool) => tool.name === 'propose_change')!
        .execute(candidate, 'first');
      yield { type: 'FAILED', code: 'AI_PROVIDER_UNAVAILABLE' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(proposals.completeWithProposal).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
  });
  it('fails separately when proposal persistence rejects without emitting ready or completing the turn', async () => {
    const conversations = conversationMock();
    const proposals = proposalMock();
    proposals.completeWithProposal.mockRejectedValue(
      new Error('raw database details'),
    );
    const provider = providerWith(async function* (_signal, tools) {
      await tools
        .find((tool) => tool.name === 'propose_change')!
        .execute(candidate, 'first');
      yield { type: 'COMPLETED' };
    });
    const events = await collect(
      await new AiOrchestrator(
        conversations,
        provider,
        registryWith([]),
        proposals,
      ).streamTurn(context, { content: 'note' }, new AbortController().signal),
    );
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      begun.turnId,
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(events.map((event) => event.event)).not.toContain('proposal.ready');
    expect(events.map((event) => event.event)).not.toContain('turn.completed');
    expect(JSON.stringify(events)).not.toContain('raw database details');
  });
});

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
    expect(conversations.contextMessages).toHaveBeenCalledWith(
      context,
      'conv-1',
    );
    expect(AI_SYSTEM_PROMPT).toMatch(/untrusted business content/i);
    expect(AI_SYSTEM_PROMPT).toMatch(/provided read tools/);
    expect(AI_SYSTEM_PROMPT).toMatch(/may be incomplete/);
    expect(AI_SYSTEM_PROMPT).toMatch(/hidden or unavailable/);
    expect(AI_SYSTEM_PROMPT).toMatch(/user's language/);
  });

  it('persists official openai providerKey when the adapter has no compatible baseURL', async () => {
    const conversations = conversationMock();
    const provider: AiProvider = {
      providerKey: 'openai',
      modelKey: 'gpt-4.1-mini',
      async *streamTurn() {
        yield { type: 'TEXT_DELTA', text: '官方路径' };
        yield { type: 'COMPLETED' };
      },
    };
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
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        providerKey: 'openai',
        modelKey: 'gpt-4.1-mini',
      }),
    );
    expect(JSON.stringify(events)).not.toContain('providerKey');
    expect(JSON.stringify(events)).not.toContain('gpt-4.1-mini');
  });

  it('persists openai-compatible providerKey for a compatible endpoint without leaking the URL', async () => {
    const conversations = conversationMock();
    const provider: AiProvider = {
      providerKey: 'openai-compatible',
      modelKey: 'deepseek-flash',
      async *streamTurn() {
        yield { type: 'TEXT_DELTA', text: '兼容路径' };
        yield { type: 'COMPLETED' };
      },
    };
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
    expect(conversations.finalizeAssistant).toHaveBeenCalledWith(
      context,
      'turn-1',
      expect.objectContaining({
        providerKey: 'openai-compatible',
        modelKey: 'deepseek-flash',
      }),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('openai-compatible');
    expect(serialized).not.toContain('deepseek-flash');
    expect(serialized).not.toContain('baseURL');
    expect(serialized).not.toContain('micuapi');
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
      data: {
        turnId: 'turn-1',
        code: 'AI_PROVIDER_TIMEOUT',
        messageId: 'asst-msg',
      },
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
      expect(events.map((event) => event.event)).not.toContain(
        'turn.cancelled',
      );
    } finally {
      if (previous === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = previous;
    }
  });

  it('finalizes FAILED AI_TURN_FAILED when contextMessages() throws after beginTurn', async () => {
    const conversations = conversationMock();
    conversations.contextMessages.mockRejectedValue(
      new Error('db unavailable'),
    );
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
      'assistant.delta',
      'sources.updated',
      'tool.completed',
      'turn.completed',
    ]);
    expect(
      events.find((event) => event.event === 'tool.started')?.data,
    ).toEqual({
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
      const result = await tools[0]!.execute(
        { objectCode: 'leads' },
        'call-fail',
      );
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
        results.push(
          await tools[0]!.execute({ objectCode: 'leads' }, `seq-${index}`),
        );
      }
      yield { type: 'TEXT_DELTA', text: '预算已达上限。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([
        searchTool(async () => ({
          items: [{ id: '1', values: { secret: 'x' } }],
        })),
      ]),
    );
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '预算' },
        new AbortController().signal,
      ),
    );
    expect(results[5]).toEqual({
      items: [{ id: '1', values: { secret: 'x' } }],
    });
    expect(results[6]).toEqual({ unavailable: true, code: 'DATA_UNAVAILABLE' });
    expect(
      events.filter((event) => event.event === 'tool.completed'),
    ).toHaveLength(6);
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
      expect(
        settled.filter(
          (item) => item && typeof item === 'object' && 'unavailable' in item,
        ),
      ).toHaveLength(1);
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
              setTimeout(
                () =>
                  resolve({ items: [{ id: '1', values: { secret: 'x' } }] }),
                20,
              );
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
    expect(
      events.filter((event) => event.event === 'tool.started'),
    ).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('yields tool.started before a deferred domain tool resolves', async () => {
    const conversations = conversationMock();
    let resolveDomain!: (value: unknown) => void;
    const domain = new Promise((resolve) => {
      resolveDomain = resolve;
    });
    const seen: string[] = [];
    const provider = providerWith(async function* (_signal, tools) {
      const pending = tools[0]!.execute({ objectCode: 'leads' }, 'live-1');
      await new Promise((resolve) => setImmediate(resolve));
      resolveDomain({ items: [{ id: '1', title: '自己的线索' }], total: 1 });
      await pending;
      yield { type: 'TEXT_DELTA', text: '查完了。' };
      yield { type: 'COMPLETED' };
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([searchTool(() => domain)]),
    );
    const stream = await orchestrator.streamTurn(
      context,
      { content: '实时' },
      new AbortController().signal,
    );
    for await (const event of stream) {
      seen.push(event.event);
      if (event.event === 'tool.started') {
        expect(seen).not.toContain('tool.completed');
        expect(seen).not.toContain('sources.updated');
      }
    }
    const startedAt = seen.indexOf('tool.started');
    const completedAt = seen.indexOf('tool.completed');
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(completedAt).toBeGreaterThan(startedAt);
    expect(seen.indexOf('sources.updated')).toBeGreaterThan(startedAt);
  });

  it('finalizes AI_PROVIDER_TIMEOUT while an in-flight tool is still pending', async () => {
    const previous = process.env.AI_TIMEOUT_MS;
    process.env.AI_TIMEOUT_MS = '20';
    const conversations = conversationMock();
    let resolveDomain!: (value: unknown) => void;
    const domain = new Promise((resolve) => {
      resolveDomain = resolve;
    });
    const execute = jest.fn(() => domain);
    const provider = providerWith(async function* (signal, tools) {
      const hanging = tools[0]!.execute({ objectCode: 'leads' }, 'hang-1');
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      void hanging;
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([searchTool(execute)]),
    );
    try {
      const events = await collect(
        await orchestrator.streamTurn(
          context,
          { content: '卡住' },
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
      expect(events.map((event) => event.event)).toContain('tool.started');
      expect(events.map((event) => event.event)).toContain('tool.failed');
      expect(events.map((event) => event.event)).not.toContain(
        'tool.completed',
      );
      const after = events.length;
      resolveDomain({ items: [{ id: 'late' }], total: 1 });
      await Promise.resolve();
      expect(events).toHaveLength(after);
    } finally {
      if (previous === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = previous;
    }
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

  it('keeps a valid in-flight tool after an unmatched tool.failed from invalid args', async () => {
    const conversations = conversationMock();
    const abort = new AbortController();
    const hanging = new Promise(() => undefined);
    const provider = providerWith(async function* (signal, tools) {
      await tools[0]!.execute(
        { objectCode: 'leads', tenantId: 'other-tenant' },
        'invalid-call',
      );
      const pending = tools[0]!.execute({ objectCode: 'leads' }, 'valid-call');
      await new Promise((resolve) => setImmediate(resolve));
      abort.abort();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      void pending;
    });
    const orchestrator = new AiOrchestrator(conversations, provider, {
      forActor(_context: TenantContext, callbacks: AiToolCallbacks) {
        const delayed: AiToolCallbacks = {
          ...callbacks,
          emit(event) {
            if (
              event.event !== 'tool.failed' ||
              event.data.callId !== 'valid-call'
            ) {
              callbacks.emit(event);
              return;
            }
            void (async () => {
              for (let index = 0; index < 5; index += 1) {
                await Promise.resolve();
              }
              callbacks.emit(event);
            })();
          },
        };
        return [
          wrapAiReadTool(
            {
              name: 'search_records',
              description: 'search',
              inputSchema: z
                .object({
                  objectCode: z.string().min(1).max(64),
                  limit: z.number().int().min(1).max(20).default(10),
                })
                .strict(),
              execute: () => hanging,
            },
            delayed,
          ),
        ];
      },
      names: () => ['search_records'],
    } as unknown as AiToolRegistry);
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: 'unmatched failed' },
        abort.signal,
      ),
    );
    const toolEvents = events.filter(
      (
        event,
      ): event is Extract<
        AiPublicStreamEvent,
        { event: 'tool.started' | 'tool.failed' | 'tool.completed' }
      > =>
        event.event === 'tool.started' ||
        event.event === 'tool.failed' ||
        event.event === 'tool.completed',
    );
    expect(
      toolEvents.map((event) => `${event.event}:${event.data.callId}`),
    ).toEqual([
      'tool.failed:invalid-call',
      'tool.started:valid-call',
      'tool.failed:valid-call',
    ]);
    expect(events.map((event) => event.event)).not.toContain('tool.completed');
  });

  it('still yields a delayed tool.failed after abort without a two-microtask drain', async () => {
    const conversations = conversationMock();
    const abort = new AbortController();
    const hanging = new Promise(() => undefined);
    const provider = providerWith(async function* (signal, tools) {
      const pending = tools[0]!.execute({ objectCode: 'leads' }, 'late-fail');
      await new Promise((resolve) => setImmediate(resolve));
      abort.abort();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      void pending;
    });
    const orchestrator = new AiOrchestrator(conversations, provider, {
      forActor(_context: TenantContext, callbacks: AiToolCallbacks) {
        const delayed: AiToolCallbacks = {
          ...callbacks,
          emit(event) {
            if (event.event !== 'tool.failed') {
              callbacks.emit(event);
              return;
            }
            void (async () => {
              for (let index = 0; index < 5; index += 1) {
                await Promise.resolve();
              }
              callbacks.emit(event);
            })();
          },
        };
        return [
          wrapAiReadTool(
            searchTool(() => hanging),
            delayed,
          ),
        ];
      },
      names: () => ['search_records'],
    } as unknown as AiToolRegistry);
    const events = await collect(
      await orchestrator.streamTurn(
        context,
        { content: '延迟失败' },
        abort.signal,
      ),
    );
    expect(events.map((event) => event.event)).toContain('tool.started');
    expect(events.map((event) => event.event)).toContain('tool.failed');
    expect(
      events.filter((event) => event.event === 'tool.started'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.event === 'tool.failed'),
    ).toHaveLength(1);
    expect(events.map((event) => event.event)).not.toContain('tool.completed');
  });

  it('fails every in-flight parallel tool after abort', async () => {
    const conversations = conversationMock();
    const abort = new AbortController();
    const hanging = new Promise(() => undefined);
    const provider = providerWith(async function* (signal, tools) {
      const pending = Promise.all([
        tools[0]!.execute({ objectCode: 'leads' }, 'p1'),
        tools[0]!.execute({ objectCode: 'leads' }, 'p2'),
        tools[0]!.execute({ objectCode: 'leads' }, 'p3'),
      ]);
      await new Promise((resolve) => setImmediate(resolve));
      abort.abort();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      void pending;
    });
    const orchestrator = new AiOrchestrator(
      conversations,
      provider,
      registryWith([searchTool(() => hanging)]),
    );
    const events = await collect(
      await orchestrator.streamTurn(context, { content: '三路' }, abort.signal),
    );
    expect(
      events.filter((event) => event.event === 'tool.started'),
    ).toHaveLength(3);
    expect(
      events.filter((event) => event.event === 'tool.failed'),
    ).toHaveLength(3);
    expect(events.map((event) => event.event)).not.toContain('tool.completed');
    expect(
      events
        .filter((event) => event.event === 'tool.failed')
        .map((event) => event.data.callId)
        .sort(),
    ).toEqual(['p1', 'p2', 'p3']);
  });

  it('registers one abort listener while merging many provider deltas', async () => {
    const queue = new AiPublicEventQueue();
    const abort = new AbortController();
    const addEventListener = jest.spyOn(abort.signal, 'addEventListener');
    async function* source() {
      for (let index = 0; index < 100; index += 1) {
        yield { type: 'TEXT_DELTA' as const, text: 'x' };
      }
      yield { type: 'COMPLETED' as const };
    }
    const items: unknown[] = [];
    for await (const item of mergeProviderAndPublicEvents(
      source(),
      queue,
      abort.signal,
    )) {
      items.push(item);
    }
    expect(
      addEventListener.mock.calls.filter((call) => call[0] === 'abort'),
    ).toHaveLength(1);
    expect(
      items.filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'kind' in item &&
          item.kind === 'provider',
      ),
    ).toHaveLength(101);
  });
});
