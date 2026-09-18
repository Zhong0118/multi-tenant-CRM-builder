import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';

const context: TenantContext = {
  tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  tenantCode: 'demo',
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
  role: 'EMPLOYEE',
};

const otherMember: TenantContext = {
  ...context,
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e11',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e12',
};

interface ConversationRow {
  id: string;
  tenantId: string;
  createdByMemberId: string;
  title: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface MessageRow {
  id: string;
  tenantId: string;
  conversationId: string;
  turnId: string;
  role: 'USER' | 'ASSISTANT';
  status: 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  content: string;
  toolSummary: unknown;
  sourceSummary: unknown;
  providerUsage: unknown;
  providerKey: string | null;
  modelKey: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function compareValues(actual: unknown, expected: unknown): number {
  const actualDate = asDate(actual);
  const expectedDate = asDate(expected);
  if (actualDate && expectedDate) return actualDate.getTime() - expectedDate.getTime();
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return actual - expected;
  }
  return String(actual) < String(expected) ? -1 : String(actual) > String(expected) ? 1 : 0;
}

function matchScalar(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (expected === null) return actual === null;
  const actualDate = asDate(actual);
  const expectedDate = asDate(expected);
  if (actualDate && expectedDate) {
    return actualDate.getTime() === expectedDate.getTime();
  }
  if (typeof expected === 'object' && expected !== null && !(expected instanceof Date)) {
    const filter = expected as Record<string, unknown>;
    if ('in' in filter && Array.isArray(filter.in)) {
      return filter.in.includes(actual);
    }
    if ('not' in filter) return actual !== filter.not;
    if ('lt' in filter && compareValues(actual, filter.lt) >= 0) return false;
    if ('lte' in filter && compareValues(actual, filter.lte) > 0) return false;
    if ('gt' in filter && compareValues(actual, filter.gt) <= 0) return false;
    if ('gte' in filter && compareValues(actual, filter.gte) < 0) return false;
    return true;
  }
  return actual === expected;
}

function matchRow(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
  conversations: ConversationRow[],
): boolean {
  if (!where) return true;
  if (where.AND) {
    const parts = Array.isArray(where.AND) ? where.AND : [where.AND];
    if (
      !parts.every((part) =>
        matchRow(row, part as Record<string, unknown>, conversations),
      )
    ) {
      return false;
    }
  }
  if (where.OR) {
    const parts = Array.isArray(where.OR) ? where.OR : [where.OR];
    if (
      !parts.some((part) =>
        matchRow(row, part as Record<string, unknown>, conversations),
      )
    ) {
      return false;
    }
  }
  if (where.NOT) {
    const parts = Array.isArray(where.NOT) ? where.NOT : [where.NOT];
    if (
      parts.some((part) =>
        matchRow(row, part as Record<string, unknown>, conversations),
      )
    ) {
      return false;
    }
  }
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') continue;
    if (key === 'conversation') {
      const conversation = conversations.find(
        (item) => item.id === row.conversationId,
      );
      if (
        !conversation ||
        !matchRow(
          conversation as unknown as Record<string, unknown>,
          expected as Record<string, unknown>,
          conversations,
        )
      ) {
        return false;
      }
      continue;
    }
    if (!matchScalar(row[key], expected)) return false;
  }
  return true;
}

function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  orderBy: Array<Record<string, 'asc' | 'desc'>> | undefined,
): T[] {
  if (!orderBy?.length) return rows;
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0]!;
      const a = left[field];
      const b = right[field];
      if (a === b) continue;
      const aTime = a instanceof Date ? a.getTime() : a;
      const bTime = b instanceof Date ? b.getTime() : b;
      if ((aTime as number) < (bTime as number)) return direction === 'asc' ? -1 : 1;
      if ((aTime as number) > (bTime as number)) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function encodeCursor(lastMessageAt: string, id: string) {
  return Buffer.from(JSON.stringify({ lastMessageAt, id }), 'utf8').toString(
    'base64url',
  );
}

function createService() {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  let ids = 0;
  const nextId = () => `00000000-0000-7000-8000-${String(++ids).padStart(12, '0')}`;
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: context.memberId }])),
    aiConversation: {
      create: ({ data }: { data: Partial<ConversationRow> }) => {
        const now = new Date();
        const row: ConversationRow = {
          id: data.id ?? nextId(),
          tenantId: data.tenantId!,
          createdByMemberId: data.createdByMemberId!,
          title: data.title!,
          lastMessageAt: data.lastMessageAt ?? now,
          createdAt: data.createdAt ?? now,
          updatedAt: now,
          deletedAt: data.deletedAt ?? null,
        };
        conversations.push(row);
        return Promise.resolve(row);
      },
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          conversations.find((item) =>
            matchRow(
              item as unknown as Record<string, unknown>,
              where,
              conversations,
            ),
          ) ?? null,
        ),
      findMany: ({
        where,
        orderBy,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Array<Record<string, 'asc' | 'desc'>>;
        take?: number;
      }) => {
        const matched = sortRows(
          conversations.filter((item) =>
            matchRow(
              item as unknown as Record<string, unknown>,
              where,
              conversations,
            ),
          ) as unknown as Array<Record<string, unknown>>,
          orderBy,
        );
        return Promise.resolve(take ? matched.slice(0, take) : matched);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ConversationRow>;
      }) => {
        const row = conversations.find((item) => item.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<ConversationRow>;
      }) => {
        let count = 0;
        for (const row of conversations) {
          if (
            matchRow(row as unknown as Record<string, unknown>, where, conversations)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },
    aiMessage: {
      create: ({ data }: { data: Partial<MessageRow> }) => {
        const now = new Date();
        const row: MessageRow = {
          id: data.id ?? nextId(),
          tenantId: data.tenantId!,
          conversationId: data.conversationId!,
          turnId: data.turnId!,
          role: data.role!,
          status: data.status!,
          content: data.content ?? '',
          toolSummary: data.toolSummary ?? [],
          sourceSummary: data.sourceSummary ?? [],
          providerUsage: data.providerUsage ?? {},
          providerKey: data.providerKey ?? null,
          modelKey: data.modelKey ?? null,
          errorCode: data.errorCode ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: now,
          completedAt: data.completedAt ?? null,
        };
        messages.push(row);
        return Promise.resolve(row);
      },
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          messages.find((item) =>
            matchRow(item as unknown as Record<string, unknown>, where, conversations),
          ) ?? null,
        ),
      findMany: ({
        where,
        orderBy,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Array<Record<string, 'asc' | 'desc'>>;
        take?: number;
      }) => {
        const matched = sortRows(
          messages.filter((item) =>
            matchRow(
              item as unknown as Record<string, unknown>,
              where,
              conversations,
            ),
          ) as unknown as Array<Record<string, unknown>>,
          orderBy,
        );
        return Promise.resolve(take ? matched.slice(0, take) : matched);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MessageRow>;
      }) => {
        const row = messages.find((item) => item.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<MessageRow>;
      }) => {
        let count = 0;
        for (const row of messages) {
          if (
            matchRow(row as unknown as Record<string, unknown>, where, conversations)
          ) {
            Object.assign(row, data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      count: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          messages.filter((item) =>
            matchRow(item as unknown as Record<string, unknown>, where, conversations),
          ).length,
        ),
    },
  };
  const withTenant = jest.fn(
    (ctx: TenantContext, work: (value: typeof tx) => Promise<unknown>) => {
      if (ctx.memberId !== context.memberId) {
        tx.$queryRaw.mockImplementationOnce(() => Promise.resolve([]));
      } else {
        tx.$queryRaw.mockImplementationOnce(() =>
          Promise.resolve([{ id: context.memberId }]),
        );
      }
      return work(tx);
    },
  );
  const repository = new ConversationRepository({
    withTenant,
  } as unknown as DatabaseContextRunner);
  return {
    service: new ConversationService(repository),
    conversations,
    messages,
  };
}

describe('ConversationService lifecycle', () => {
  it('has no create() that inserts an empty conversation on page/new-click', async () => {
    const { service } = createService();
    expect(
      (service as unknown as { create?: unknown }).create,
    ).toBeUndefined();
    const listed = await service.list(context, {});
    expect(listed.items).toEqual([]);
    expect(listed.nextCursor).toBeUndefined();
  });

  it('creates conversation + USER COMPLETED + ASSISTANT GENERATING on first beginTurn', async () => {
    const { service, conversations, messages } = createService();
    const begun = await service.beginTurn(context, { content: '帮我看看本月商机' });
    expect(conversations).toHaveLength(1);
    expect(begun.conversationId).toBe(conversations[0]!.id);
    expect(begun.turnId).toEqual(expect.any(String));
    expect(messages).toHaveLength(2);
    const user = messages.find((row) => row.role === 'USER');
    const assistant = messages.find((row) => row.role === 'ASSISTANT');
    expect(user).toMatchObject({
      status: 'COMPLETED',
      content: '帮我看看本月商机',
      turnId: begun.turnId,
      completedAt: expect.any(Date),
    });
    expect(assistant).toMatchObject({
      status: 'GENERATING',
      content: '',
      turnId: begun.turnId,
      completedAt: null,
    });
    expect(user?.turnId).toBe(assistant?.turnId);
  });

  it('derives title from the first 30 Unicode code points of the first user message', async () => {
    const { service } = createService();
    const content = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超出';
    const begun = await service.beginTurn(context, { content });
    expect(begun.title).toBe('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十');
    expect([...begun.title]).toHaveLength(30);
    await service.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: 'ok',
    });
    const emoji = await service.beginTurn(context, {
      content: '😀'.repeat(31),
    });
    expect(emoji.title).toBe('😀'.repeat(30));
  });

  it('preserves title and updates lastMessageAt when continuing a conversation', async () => {
    const { service, conversations } = createService();
    const first = await service.beginTurn(context, { content: '原始标题来源' });
    await service.finalizeAssistant(context, first.turnId, {
      status: 'COMPLETED',
      content: '好',
    });
    const before = conversations[0]!.lastMessageAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const continued = await service.beginTurn(context, {
      conversationId: first.conversationId,
      content: '继续追问，不要改标题',
    });
    expect(continued.title).toBe(first.title);
    expect(conversations[0]!.title).toBe(first.title);
    expect(conversations[0]!.lastMessageAt.getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it('lists conversations by lastMessageAt DESC then id DESC', async () => {
    const { service, conversations } = createService();
    const older = await service.beginTurn(context, { content: '旧' });
    await service.finalizeAssistant(context, older.turnId, {
      status: 'COMPLETED',
      content: 'a',
    });
    conversations[0]!.lastMessageAt = new Date('2026-09-18T10:00:00.000Z');
    const newer = await service.beginTurn(context, { content: '新' });
    await service.finalizeAssistant(context, newer.turnId, {
      status: 'COMPLETED',
      content: 'b',
    });
    conversations.find((row) => row.id === newer.conversationId)!.lastMessageAt =
      new Date('2026-09-18T11:00:00.000Z');
    const sameTimeA = await service.beginTurn(context, { content: '同刻A' });
    await service.finalizeAssistant(context, sameTimeA.turnId, {
      status: 'COMPLETED',
      content: 'c',
    });
    const sameTimeB = await service.beginTurn(context, { content: '同刻B' });
    await service.finalizeAssistant(context, sameTimeB.turnId, {
      status: 'COMPLETED',
      content: 'd',
    });
    const stamp = new Date('2026-09-18T12:00:00.000Z');
    for (const id of [sameTimeA.conversationId, sameTimeB.conversationId]) {
      conversations.find((row) => row.id === id)!.lastMessageAt = stamp;
    }
    const listed = await service.list(context, {});
    const ids = listed.items.map((item) => item.id);
    const sameTimeIds = [sameTimeA.conversationId, sameTimeB.conversationId].sort(
      (left, right) => (left < right ? 1 : -1),
    );
    expect(ids.slice(0, 2)).toEqual(sameTimeIds);
    expect(ids[2]).toBe(newer.conversationId);
    expect(ids[3]).toBe(older.conversationId);
  });

  it('returns the latest 30 messages and supports before as a message id cursor', async () => {
    const { service, messages } = createService();
    const first = await service.beginTurn(context, { content: 'seed' });
    await service.finalizeAssistant(context, first.turnId, {
      status: 'COMPLETED',
      content: 'seed-answer',
    });
    for (const row of messages) {
      if (row.turnId === first.turnId) {
        row.createdAt = new Date(Date.now() - 30 * 60_000);
      }
    }
    for (let index = 0; index < 20; index += 1) {
      const turn = await service.beginTurn(context, {
        conversationId: first.conversationId,
        content: `追问${index}`,
      });
      await service.finalizeAssistant(context, turn.turnId, {
        status: 'COMPLETED',
        content: `答${index}`,
      });
      for (const row of messages) {
        if (row.turnId === turn.turnId) {
          row.createdAt = new Date(
            Date.now() - (20 - index) * 60_000 - 6 * 60_000,
          );
        }
      }
    }
    expect(messages.filter((row) => row.role === 'USER')).toHaveLength(21);
    expect(messages).toHaveLength(42);
    const latest = await service.messages(context, first.conversationId, {});
    expect(latest.items).toHaveLength(30);
    const latestIds = latest.items.map((item) => item.id);
    const chronological = [...messages].sort((left, right) => {
      if (left.createdAt.getTime() !== right.createdAt.getTime()) {
        return left.createdAt.getTime() - right.createdAt.getTime();
      }
      return left.id < right.id ? -1 : 1;
    });
    expect(latestIds).toEqual(chronological.slice(-30).map((row) => row.id));
    const oldestOfPage = latest.items[0]!;
    const older = await service.messages(context, first.conversationId, {
      before: oldestOfPage.id,
    });
    expect(older.items.length).toBeGreaterThan(0);
    expect(older.items.map((item) => item.id)).toEqual(
      chronological.slice(0, 12).map((row) => row.id),
    );
  });

  it('does not bump lastMessageAt on rename', async () => {
    const { service, conversations } = createService();
    const begun = await service.beginTurn(context, { content: '改名前' });
    const before = conversations[0]!.lastMessageAt;
    const renamed = await service.rename(context, begun.conversationId, '新名字');
    expect(renamed.title).toBe('新名字');
    expect(conversations[0]!.lastMessageAt).toEqual(before);
  });

  it('soft-deletes on remove and hides the conversation from list and messages', async () => {
    const { service, conversations } = createService();
    const begun = await service.beginTurn(context, { content: '删我' });
    await expect(
      service.remove(context, begun.conversationId),
    ).rejects.toMatchObject({
      code: 'AI_MEMBER_TURN_IN_PROGRESS',
      status: 409,
    });
    await service.finalizeAssistant(context, begun.turnId, {
      status: 'CANCELLED',
      content: '停',
    });
    await service.remove(context, begun.conversationId);
    expect(conversations[0]!.deletedAt).toEqual(expect.any(Date));
    expect((await service.list(context, {})).items).toEqual([]);
    await expect(
      service.messages(context, begun.conversationId, {}),
    ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND', status: 404 });
    await expect(
      service.beginTurn(context, {
        conversationId: begun.conversationId,
        content: '还想继续',
      }),
    ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND' });
  });

  it('returns not-found semantics for another member', async () => {
    const { service } = createService();
    const begun = await service.beginTurn(context, { content: '我的会话' });
    await expect(
      service.messages(otherMember, begun.conversationId, {}),
    ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND', status: 404 });
    await expect(
      service.rename(otherMember, begun.conversationId, '劫持'),
    ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND' });
    await expect(
      service.remove(otherMember, begun.conversationId),
    ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND' });
    expect((await service.list(otherMember, {})).items).toEqual([]);
  });

  it('fails closed when the member lock is missing (disabled member)', async () => {
    const conversations: ConversationRow[] = [];
    const messages: MessageRow[] = [];
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      aiConversation: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      aiMessage: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const repository = new ConversationRepository({
      withTenant: (
        _ctx: TenantContext,
        work: (value: typeof tx) => Promise<unknown>,
      ) => work(tx),
    } as unknown as DatabaseContextRunner);
    const service = new ConversationService(repository);
    await expect(
      service.beginTurn(context, { content: '禁用成员' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN', status: 403 });
    expect(conversations).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it('retries only FAILED or CANCELLED assistant turns', async () => {
    const { service, messages } = createService();
    const generating = await service.beginTurn(context, { content: '进行中不能重试' });
    await expect(
      service.retryTurn(context, generating.turnId),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE', status: 409 });
    await service.finalizeAssistant(context, generating.turnId, {
      status: 'COMPLETED',
      content: '完成了',
    });
    await expect(
      service.retryTurn(context, generating.turnId),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE' });

    const failed = await service.beginTurn(context, { content: '失败可重试' });
    await service.finalizeAssistant(context, failed.turnId, {
      status: 'FAILED',
      content: '错了',
    });
    const retried = await service.retryTurn(context, failed.turnId);
    expect(retried.assistant.status).toBe('GENERATING');
    expect(messages.filter((row) => row.role === 'USER')).toHaveLength(2);
  });

  it('paginates conversation list with an opaque lastMessageAt+id cursor', async () => {
    const { service, conversations } = createService();
    const first = await service.beginTurn(context, { content: '一' });
    await service.finalizeAssistant(context, first.turnId, {
      status: 'COMPLETED',
      content: '答一',
    });
    const second = await service.beginTurn(context, { content: '二' });
    conversations.find((row) => row.id === first.conversationId)!.lastMessageAt =
      new Date('2026-09-18T10:00:00.000Z');
    conversations.find((row) => row.id === second.conversationId)!.lastMessageAt =
      new Date('2026-09-18T11:00:00.000Z');
    const page = await service.list(context, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(second.conversationId);
    expect(page.nextCursor).toBe(
      encodeCursor(page.items[0]!.lastMessageAt, page.items[0]!.id),
    );
    const next = await service.list(context, { cursor: page.nextCursor, limit: 1 });
    expect(next.items[0]!.id).toBe(first.conversationId);
  });
});
