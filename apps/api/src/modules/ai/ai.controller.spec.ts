import { AiController } from './ai.controller';
import { AiOrchestrator } from './ai-orchestrator';
import { ConversationService } from './conversation.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { sseFrame } from './ai-stream';
import type { AiPublicStreamEvent } from '../../../../../packages/contracts/src/ai/stream';

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
    },
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
    orchestrator.streamTurn.mockImplementation(async function* () {
      yield* events;
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
    expect(request.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(response.writes).toEqual(events.map((event) => sseFrame(event)));
    expect(response.writableEnded).toBe(true);
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
