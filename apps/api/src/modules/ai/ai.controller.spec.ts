import { EventEmitter } from 'node:events';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AiPublicStreamEvent } from '@crm/contracts';
import { AiController } from './ai.controller';
import { AiOrchestrator } from './ai-orchestrator';
import { sseFrame } from './ai-stream';
import { ConversationService } from './conversation.service';

const context: TenantContext = {
  tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  tenantCode: 'demo',
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
  role: 'EMPLOYEE',
};

function mockResponse() {
  const writes: string[] = [];
  const headers = new Map<string, string>();
  const emitter = new EventEmitter();
  const response = {
    statusCode: 0,
    writableEnded: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    flushHeaders: jest.fn(),
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
      emitter.emit('end');
    },
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    headers,
    writes,
  };
  return response;
}

describe('AiController', () => {
  const conversations = {
    list: jest.fn(),
    messages: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<ConversationService>;

  const orchestrator = {
    streamTurn: jest.fn(),
    retryTurn: jest.fn(),
  } as unknown as jest.Mocked<AiOrchestrator>;

  const controller = new AiController(conversations, orchestrator);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets SSE content-type and related headers on POST turns', async () => {
    const events: AiPublicStreamEvent[] = [
      {
        event: 'conversation.ready',
        data: { conversationId: 'c1', title: 't', turnId: 'turn-1' },
      },
      { event: 'turn.started', data: { turnId: 'turn-1' } },
    ];
    orchestrator.streamTurn.mockImplementation(async () => {
      return (async function* () {
        yield* events;
      })();
    });
    const response = mockResponse();
    const request = { on: jest.fn() };
    await controller.startTurn(
      context,
      { content: '你好' },
      request as never,
      response as never,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.flushHeaders).toHaveBeenCalled();
    expect(response.writes).toEqual(events.map((event) => sseFrame(event)));
    expect(response.writableEnded).toBe(true);
  });

  it('does not flush SSE headers when beginTurn rejects, so JSON errors stay available', async () => {
    orchestrator.streamTurn.mockRejectedValue(
      new ApiException('AI_RATE_LIMITED', 429),
    );
    const response = mockResponse();
    const request = { on: jest.fn() };
    await expect(
      controller.startTurn(
        context,
        { content: '你好' },
        request as never,
        response as never,
      ),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(response.writes).toEqual([]);
  });

  it('does not flush SSE headers when retryTurn rejects in-progress', async () => {
    orchestrator.retryTurn.mockRejectedValue(
      new ApiException('AI_MEMBER_TURN_IN_PROGRESS', 409),
    );
    const response = mockResponse();
    const request = { on: jest.fn() };
    await expect(
      controller.retryTurn(
        context,
        '00000000-0000-7000-8000-000000000001',
        request as never,
        response as never,
      ),
    ).rejects.toMatchObject({
      code: 'AI_MEMBER_TURN_IN_PROGRESS',
      status: 409,
    });
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(response.writes).toEqual([]);
  });

  it('aborts only on response close while the stream is still open', async () => {
    let observed: AbortSignal | undefined;
    let release: (() => void) | undefined;
    orchestrator.streamTurn.mockImplementation(
      async (_context, _dto, signal: AbortSignal) => {
        observed = signal;
        return (async function* () {
          yield {
            event: 'conversation.ready',
            data: { conversationId: 'c1', title: 't', turnId: 'turn-1' },
          };
          await new Promise<void>((resolve) => {
            release = resolve;
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        })();
      },
    );
    const response = mockResponse();
    const request = { on: jest.fn() };
    const done = controller.startTurn(
      context,
      { content: '你好' },
      request as never,
      response as never,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(observed?.aborted).toBe(false);
    response.emit('close');
    await done;
    expect(observed?.aborted).toBe(true);
    expect(response.writableEnded).toBe(true);
    release?.();
  });

  it('does not treat a clean response.end as client cancel', async () => {
    let observed: AbortSignal | undefined;
    orchestrator.streamTurn.mockImplementation(
      async (_context, _dto, signal: AbortSignal) => {
        observed = signal;
        return (async function* () {
          yield { event: 'turn.started', data: { turnId: 'turn-1' } };
        })();
      },
    );
    const response = mockResponse();
    const request = { on: jest.fn() };
    await controller.startTurn(
      context,
      { content: '你好' },
      request as never,
      response as never,
    );
    expect(response.writableEnded).toBe(true);
    expect(observed?.aborted).toBe(false);
  });

  it('CRUD routes use CurrentTenant context and never actor query params', async () => {
    conversations.list.mockResolvedValue({ items: [] });
    conversations.messages.mockResolvedValue({ items: [] });
    conversations.rename.mockResolvedValue({
      id: 'c1',
      title: '新',
      lastMessageAt: '2026-09-18T10:00:00.000Z',
    });
    conversations.remove.mockResolvedValue(undefined);

    await controller.listConversations(context, {});
    await controller.listMessages(context, 'c1', {});
    await controller.renameConversation(context, 'c1', { title: '新' });
    await controller.removeConversation(context, 'c1');

    expect(conversations.list).toHaveBeenCalledWith(context, {});
    expect(conversations.messages).toHaveBeenCalledWith(context, 'c1', {});
    expect(conversations.rename).toHaveBeenCalledWith(context, 'c1', '新');
    expect(conversations.remove).toHaveBeenCalledWith(context, 'c1');
    expect(AiController.prototype.listConversations.length).toBe(2);
  });
});
