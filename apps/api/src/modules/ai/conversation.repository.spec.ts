import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { ApiException } from '../../common/errors/api.exception';
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

function harness(options: { lockedMembers?: Array<{ id: string }> } = {}) {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  const sqlCalls: string[] = [];
  let ids = 0;
  const nextId = () => `00000000-0000-7000-8000-${String(++ids).padStart(12, '0')}`;

  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('$').replace(/\s+/g, ' ').trim();
      sqlCalls.push(sql);
      if (/FROM tenant_members/.test(sql)) {
        return Promise.resolve(
          options.lockedMembers ?? [{ id: context.memberId }],
        );
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    aiConversation: {
      create: jest.fn(({ data }: { data: Partial<ConversationRow> }) => {
        const now = new Date();
        const row: ConversationRow = {
          id: data.id ?? nextId(),
          tenantId: data.tenantId!,
          createdByMemberId: data.createdByMemberId!,
          title: data.title!,
          lastMessageAt: data.lastMessageAt ?? now,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deletedAt: data.deletedAt ?? null,
        };
        conversations.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const row = conversations.find((item) =>
          matchRow(item as unknown as Record<string, unknown>, where, conversations),
        );
        return Promise.resolve(row ?? null);
      }),
      findMany: jest.fn(
        ({
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
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ConversationRow>;
        }) => {
          const row = conversations.find((item) => item.id === where.id);
          if (!row) return Promise.resolve(null);
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({
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
      ),
    },
    aiMessage: {
      create: jest.fn(({ data }: { data: Partial<MessageRow> }) => {
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
          updatedAt: data.updatedAt ?? now,
          completedAt: data.completedAt ?? null,
        };
        messages.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const row = messages.find((item) =>
          matchRow(item as unknown as Record<string, unknown>, where, conversations),
        );
        return Promise.resolve(row ?? null);
      }),
      findMany: jest.fn(
        ({
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
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MessageRow>;
        }) => {
          const row = messages.find((item) => item.id === where.id);
          if (!row) return Promise.resolve(null);
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({
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
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          messages.filter((item) =>
            matchRow(item as unknown as Record<string, unknown>, where, conversations),
          ).length,
        ),
      ),
    },
  };

  const withTenant = jest.fn(
    (_ctx: TenantContext, work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
  );
  const repository = new ConversationRepository({
    withTenant,
  } as unknown as DatabaseContextRunner);
  const service = new ConversationService(repository);
  return {
    tx,
    withTenant,
    sqlCalls,
    conversations,
    messages,
    repository,
    service,
  };
}

describe('ConversationRepository member lock and turn lifecycle', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.AI_TIMEOUT_MS;
  });

  it('locks the active tenant member with FOR UPDATE inside one tenant transaction', async () => {
    const fixture = harness();
    await fixture.repository.beginTurn(context, { content: '你好' });
    expect(fixture.withTenant).toHaveBeenCalledTimes(1);
    expect(fixture.sqlCalls[0]).toContain('FROM tenant_members');
    expect(fixture.sqlCalls[0]).toContain('FOR UPDATE');
    expect(fixture.sqlCalls[0]).toContain("status = 'ACTIVE'");
  });

  it('fails closed when the member lock misses', async () => {
    const fixture = harness({ lockedMembers: [] });
    await expect(
      fixture.repository.beginTurn(context, { content: '你好' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN', status: 403 });
    expect(fixture.conversations).toHaveLength(0);
  });

  it('marks stale GENERATING assistant rows FAILED after timeout plus 15s grace', async () => {
    process.env.AI_TIMEOUT_MS = '45000';
    const now = new Date('2026-09-18T12:00:00.000Z');
    jest.useFakeTimers({ now });
    const fixture = harness();
    const staleAt = new Date(now.getTime() - 45_000 - 15_000 - 1);
    fixture.conversations.push({
      id: 'conv-stale',
      tenantId: context.tenantId,
      createdByMemberId: context.memberId,
      title: '旧会话',
      lastMessageAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt,
      deletedAt: null,
    });
    fixture.messages.push({
      id: 'msg-stale-user',
      tenantId: context.tenantId,
      conversationId: 'conv-stale',
      turnId: 'turn-stale',
      role: 'USER',
      status: 'COMPLETED',
      content: '旧问题',
      toolSummary: [],
      sourceSummary: [],
      providerUsage: {},
      providerKey: null,
      modelKey: null,
      errorCode: null,
      createdAt: staleAt,
      updatedAt: staleAt,
      completedAt: staleAt,
    });
    fixture.messages.push({
      id: 'msg-stale-assistant',
      tenantId: context.tenantId,
      conversationId: 'conv-stale',
      turnId: 'turn-stale',
      role: 'ASSISTANT',
      status: 'GENERATING',
      content: '半成品',
      toolSummary: [{ callId: '1' }],
      sourceSummary: [{ kind: 'RECORDS' }],
      providerUsage: { inputTokens: 1 },
      providerKey: 'openai',
      modelKey: 'gpt',
      errorCode: null,
      createdAt: staleAt,
      updatedAt: staleAt,
      completedAt: null,
    });

    await fixture.repository.beginTurn(context, { content: '新问题' });

    const stale = fixture.messages.find((row) => row.id === 'msg-stale-assistant');
    expect(stale?.status).toBe('FAILED');
    expect(stale?.status).not.toBe('CANCELLED');
    expect(fixture.messages.filter((row) => row.role === 'USER')).toHaveLength(2);
  });

  it('rejects a remaining in-progress GENERATING assistant with 409', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    jest.useFakeTimers({ now });
    const fixture = harness();
    const recent = new Date(now.getTime() - 1_000);
    fixture.conversations.push({
      id: 'conv-live',
      tenantId: context.tenantId,
      createdByMemberId: context.memberId,
      title: '进行中',
      lastMessageAt: recent,
      createdAt: recent,
      updatedAt: recent,
      deletedAt: null,
    });
    fixture.messages.push({
      id: 'msg-live',
      tenantId: context.tenantId,
      conversationId: 'conv-live',
      turnId: 'turn-live',
      role: 'ASSISTANT',
      status: 'GENERATING',
      content: '',
      toolSummary: [],
      sourceSummary: [],
      providerUsage: {},
      providerKey: null,
      modelKey: null,
      errorCode: null,
      createdAt: recent,
      updatedAt: recent,
      completedAt: null,
    });

    await expect(
      fixture.repository.beginTurn(context, { content: '再问一句' }),
    ).rejects.toMatchObject({
      code: 'AI_MEMBER_TURN_IN_PROGRESS',
      status: 409,
    });
  });

  it('rate-limits the 21st new USER turn in five minutes', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    jest.useFakeTimers({ now });
    const fixture = harness();
    for (let index = 0; index < 20; index += 1) {
      await fixture.repository.beginTurn(context, { content: `问题${index}` });
      const assistant = fixture.messages.filter((row) => row.role === 'ASSISTANT').at(-1)!;
      await fixture.repository.finalizeAssistant(context, assistant.turnId, {
        status: 'FAILED',
        content: '',
      });
    }

    await expect(
      fixture.repository.beginTurn(context, { content: '第21问' }),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });
    expect(fixture.messages.filter((row) => row.role === 'USER')).toHaveLength(20);
  });

  it('counts extra retry attempts toward the same 20-per-5-minutes member budget', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    jest.useFakeTimers({ now });
    const fixture = harness();
    for (let index = 0; index < 19; index += 1) {
      const begun = await fixture.repository.beginTurn(context, {
        content: `问题${index}`,
      });
      await fixture.repository.finalizeAssistant(context, begun.turnId, {
        status: 'FAILED',
        content: '',
      });
    }
    const last = await fixture.repository.beginTurn(context, { content: '第20问' });
    await fixture.repository.finalizeAssistant(context, last.turnId, {
      status: 'FAILED',
      content: '',
    });
    expect(
      (last.assistant.providerUsage as { providerAttempts?: number }).providerAttempts,
    ).toBe(1);

    await expect(
      fixture.repository.retryTurn(context, last.turnId),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });

    const nineteenth = fixture.messages.find(
      (row) => row.role === 'USER' && row.content === '问题0',
    );
    expect(nineteenth).toBeDefined();
  });

  it('allows a retry when USER+extra attempts are still under 20, then blocks the next begin', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    jest.useFakeTimers({ now });
    const fixture = harness();
    const turns: string[] = [];
    for (let index = 0; index < 19; index += 1) {
      const begun = await fixture.repository.beginTurn(context, {
        content: `问题${index}`,
      });
      await fixture.repository.finalizeAssistant(context, begun.turnId, {
        status: 'FAILED',
        content: '',
      });
      turns.push(begun.turnId);
    }
    const retried = await fixture.repository.retryTurn(context, turns[0]!);
    expect(retried.assistant.status).toBe('GENERATING');
    expect(
      (retried.assistant.providerUsage as { providerAttempts: number }).providerAttempts,
    ).toBe(2);
    await fixture.repository.finalizeAssistant(context, retried.turnId, {
      status: 'COMPLETED',
      content: '重试完成',
    });

    await expect(
      fixture.repository.beginTurn(context, { content: '第20问应被拦住' }),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });
  });

  it('retry resets the existing assistant and does not duplicate the USER row', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '重试我' });
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'CANCELLED',
      content: '半段',
      usage: { inputTokens: 9 },
    });
    const before = fixture.messages.filter((row) => row.role === 'USER').length;

    const retried = await fixture.repository.retryTurn(context, begun.turnId);

    expect(retried.assistant.id).toBe(begun.assistant.id);
    expect(retried.assistant.status).toBe('GENERATING');
    expect(retried.assistant.content).toBe('');
    expect(retried.assistant.toolSummary).toEqual([]);
    expect(retried.assistant.sourceSummary).toEqual([]);
    expect(retried.assistant.providerUsage).toEqual({ providerAttempts: 2 });
    expect(retried.assistant.errorCode).toBeNull();
    expect(retried.assistant.completedAt).toBeNull();
    expect(fixture.messages.filter((row) => row.role === 'USER')).toHaveLength(before);
  });

  it('rejects retry on a COMPLETED assistant', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '完成' });
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: '答好了',
    });
    await expect(
      fixture.repository.retryTurn(context, begun.turnId),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE', status: 409 });
  });

  it('does not expose provider fields on ordinary message DTOs after finalize', async () => {
    const fixture = harness();
    const begun = await fixture.service.beginTurn(context, { content: '用量' });
    await fixture.service.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: '答案',
      usage: { inputTokens: 3, outputTokens: 5 },
      providerKey: 'openai',
      modelKey: 'gpt-4.1',
    });
    const page = await fixture.service.messages(context, begun.conversationId, {});
    for (const item of page.items) {
      expect(item).not.toHaveProperty('providerUsage');
      expect(item).not.toHaveProperty('providerKey');
      expect(item).not.toHaveProperty('modelKey');
    }
  });

  it('persists providerKey and modelKey on the assistant row, not only inside usage JSON', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '用量列' });
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: '答案',
      usage: { inputTokens: 3, outputTokens: 5, latencyMs: 12 },
      providerKey: 'openai',
      modelKey: 'gpt-4.1',
    });
    const assistant = fixture.messages.find((row) => row.id === begun.assistant.id);
    expect(assistant?.providerKey).toBe('openai');
    expect(assistant?.modelKey).toBe('gpt-4.1');
    expect(assistant?.providerUsage).toEqual({
      inputTokens: 3,
      outputTokens: 5,
      latencyMs: 12,
      providerAttempts: 1,
    });
    expect(assistant?.providerUsage).not.toHaveProperty('providerKey');
    expect(assistant?.providerUsage).not.toHaveProperty('modelKey');
  });

  it('persists openai-compatible providerKey on the assistant row without exposing it on the DTO', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '兼容网关' });
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'COMPLETED',
      content: '答案',
      usage: { inputTokens: 3, outputTokens: 5, latencyMs: 12 },
      providerKey: 'openai-compatible',
      modelKey: 'deepseek-flash',
    });
    const assistant = fixture.messages.find((row) => row.id === begun.assistant.id);
    expect(assistant?.providerKey).toBe('openai-compatible');
    expect(assistant?.modelKey).toBe('deepseek-flash');
    const page = await fixture.service.messages(context, begun.conversationId, {});
    for (const item of page.items) {
      expect(item).not.toHaveProperty('providerUsage');
      expect(item).not.toHaveProperty('providerKey');
      expect(item).not.toHaveProperty('modelKey');
    }
  });

  it('persists providerKey and modelKey on FAILED turns when already known', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '失败也记' });
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'FAILED',
      content: '半段',
      errorCode: 'AI_PROVIDER_TIMEOUT',
      providerKey: 'openai',
      modelKey: 'gpt-4.1',
    });
    const assistant = fixture.messages.find((row) => row.id === begun.assistant.id);
    expect(assistant?.providerKey).toBe('openai');
    expect(assistant?.modelKey).toBe('gpt-4.1');
    expect(assistant?.errorCode).toBe('AI_PROVIDER_TIMEOUT');
  });

  it('rejects deleting a conversation that still has a GENERATING assistant', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '别删' });
    fixture.sqlCalls.length = 0;
    await expect(
      fixture.repository.remove(context, begun.conversationId),
    ).rejects.toMatchObject({
      code: 'AI_MEMBER_TURN_IN_PROGRESS',
      status: 409,
    });
    expect(fixture.sqlCalls[0]).toContain('FROM tenant_members');
    expect(fixture.sqlCalls[0]).toContain('FOR UPDATE');
    expect(
      fixture.conversations.find((row) => row.id === begun.conversationId)?.deletedAt,
    ).toBeNull();
    await fixture.repository.finalizeAssistant(context, begun.turnId, {
      status: 'CANCELLED',
      content: '停',
    });
    await expect(
      fixture.repository.remove(context, begun.conversationId),
    ).resolves.toBeUndefined();
    expect(
      fixture.conversations.find((row) => row.id === begun.conversationId)?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it('maps invalid conversation cursors to AI_CURSOR_INVALID instead of JSON errors', async () => {
    const fixture = harness();
    await expect(
      fixture.service.list(context, { cursor: 'not-json' }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      fixture.service.list(context, { cursor: 'not-json' }),
    ).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID', status: 400 });
    await expect(
      fixture.service.list(context, {
        cursor: Buffer.from('{}', 'utf8').toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID', status: 400 });
    await expect(
      fixture.service.list(context, {
        cursor: Buffer.from(
          JSON.stringify({ lastMessageAt: 'abc', id: context.tenantId }),
          'utf8',
        ).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID', status: 400 });
    await expect(
      fixture.service.list(context, {
        cursor: Buffer.from(
          JSON.stringify({
            lastMessageAt: '2026-09-18T12:00:00.000Z',
            id: 'not-a-uuid',
          }),
          'utf8',
        ).toString('base64url'),
      }),
    ).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID', status: 400 });
  });

  it('does not let another member lock succeed for this conversation', async () => {
    const fixture = harness();
    const begun = await fixture.repository.beginTurn(context, { content: '私有' });
    fixture.tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('$');
      fixture.sqlCalls.push(sql);
      return Promise.resolve([]);
    });
    await expect(
      fixture.repository.beginTurn(otherMember, {
        conversationId: begun.conversationId,
        content: '偷看',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });
});
