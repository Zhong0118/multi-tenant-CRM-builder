import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type {
  AssistantFinalizeOutcome,
  BeginTurnInput,
  BeginTurnResult,
  ConversationListPage,
  ConversationListQuery,
  ConversationMessagePage,
  ConversationMessageQuery,
  PublicAiMessage,
} from './ai.types';

export const AI_STALE_GENERATING_GRACE_MS = 15_000;
const DEFAULT_AI_TIMEOUT_MS = 45_000;
const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 50;
const NEW_TURN_WINDOW_MS = 5 * 60 * 1000;
const NEW_TURN_LIMIT = 20;
const TITLE_CODE_POINTS = 30;
const TITLE_MAX_CHARS = 120;

type Tx = Prisma.TransactionClient;

function emptyJsonArray(): Prisma.InputJsonValue {
  return [];
}

function emptyJsonObject(): Prisma.InputJsonValue {
  return {};
}

export function encodeConversationCursor(input: {
  lastMessageAt: string;
  id: string;
}): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

export function decodeConversationCursor(value: string): {
  lastMessageAt: string;
  id: string;
} {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed?.lastMessageAt !== 'string' ||
      typeof parsed?.id !== 'string'
    ) {
      throw new ApiException('AI_CURSOR_INVALID', 400);
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiException) throw error;
    throw new ApiException('AI_CURSOR_INVALID', 400);
  }
}

function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);
}

function timeoutMs(): number {
  const raw = process.env.AI_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_AI_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS;
}

export function deriveConversationTitle(content: string): string {
  const sliced = [...content].slice(0, TITLE_CODE_POINTS).join('').trim();
  const title = sliced.slice(0, TITLE_MAX_CHARS);
  return title.length > 0 ? title : '新对话';
}

function toPublicMessage(row: {
  id: string;
  conversationId: string;
  turnId: string;
  role: 'USER' | 'ASSISTANT';
  status: 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  content: string;
  toolSummary: unknown;
  sourceSummary: unknown;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): PublicAiMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    role: row.role,
    status: row.status,
    content: row.content,
    toolSummary: row.toolSummary,
    sourceSummary: row.sourceSummary,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function asTurnResult(
  conversation: { id: string; title: string },
  user: {
    id: string;
    status: BeginTurnResult['user']['status'];
    content: string;
    turnId: string;
    completedAt: Date | null;
  },
  assistant: {
    id: string;
    status: BeginTurnResult['assistant']['status'];
    content: string;
    turnId: string;
    toolSummary: unknown;
    sourceSummary: unknown;
    providerUsage: unknown;
    errorCode: string | null;
    completedAt: Date | null;
  },
): BeginTurnResult {
  return {
    conversationId: conversation.id,
    title: conversation.title,
    turnId: assistant.turnId,
    user: {
      id: user.id,
      status: user.status,
      content: user.content,
      turnId: user.turnId,
      completedAt: user.completedAt,
    },
    assistant: {
      id: assistant.id,
      status: assistant.status,
      content: assistant.content,
      turnId: assistant.turnId,
      toolSummary: assistant.toolSummary,
      sourceSummary: assistant.sourceSummary,
      providerUsage: assistant.providerUsage,
      errorCode: assistant.errorCode,
      completedAt: assistant.completedAt,
    },
  };
}

async function lockActiveMember(tx: Tx, context: TenantContext): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM tenant_members
    WHERE tenant_id = ${context.tenantId}::uuid
      AND id = ${context.memberId}::uuid
      AND user_id = ${context.userId}::uuid
      AND status = 'ACTIVE'
    FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
  }
}

function memberConversationWhere(
  context: TenantContext,
): Prisma.AiConversationWhereInput {
  return {
    tenantId: context.tenantId,
    createdByMemberId: context.memberId,
  };
}

async function failStaleGenerating(
  tx: Tx,
  context: TenantContext,
  now: Date,
): Promise<void> {
  const cutoff = new Date(
    now.getTime() - timeoutMs() - AI_STALE_GENERATING_GRACE_MS,
  );
  await tx.aiMessage.updateMany({
    where: {
      tenantId: context.tenantId,
      role: 'ASSISTANT',
      status: 'GENERATING',
      createdAt: { lt: cutoff },
      conversation: memberConversationWhere(context),
    },
    data: {
      status: 'FAILED',
      completedAt: now,
    },
  });
}

async function rejectInProgress(
  tx: Tx,
  context: TenantContext,
  exceptId?: string,
): Promise<void> {
  const inProgress = await tx.aiMessage.findFirst({
    where: {
      tenantId: context.tenantId,
      role: 'ASSISTANT',
      status: 'GENERATING',
      id: exceptId ? { not: exceptId } : undefined,
      conversation: memberConversationWhere(context),
    },
    select: { id: true },
  });
  if (inProgress) {
    throw new ApiException('AI_MEMBER_TURN_IN_PROGRESS', 409);
  }
}

async function enforceNewTurnRateLimit(
  tx: Tx,
  context: TenantContext,
  now: Date,
): Promise<void> {
  const recentTurns = await tx.aiMessage.count({
    where: {
      tenantId: context.tenantId,
      role: 'USER',
      createdAt: { gte: new Date(now.getTime() - NEW_TURN_WINDOW_MS) },
      conversation: memberConversationWhere(context),
    },
  });
  if (recentTurns >= NEW_TURN_LIMIT) {
    throw new ApiException('AI_RATE_LIMITED', 429);
  }
}

async function requireOwnedConversation(
  tx: Tx,
  context: TenantContext,
  conversationId: string,
) {
  const conversation = await tx.aiConversation.findFirst({
    where: {
      id: conversationId,
      tenantId: context.tenantId,
      createdByMemberId: context.memberId,
      deletedAt: null,
    },
  });
  if (!conversation) {
    throw new ApiException('AI_CONVERSATION_NOT_FOUND', 404);
  }
  return conversation;
}

@Injectable()
export class ConversationRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  list(
    context: TenantContext,
    query: ConversationListQuery,
  ): Promise<ConversationListPage> {
    return this.runner.withTenant(context, async (tx) => {
      const limit = pageLimit(query.limit);
      const cursor = query.cursor
        ? decodeConversationCursor(query.cursor)
        : undefined;
      const cursorDate = cursor ? new Date(cursor.lastMessageAt) : undefined;
      const where: Prisma.AiConversationWhereInput = {
        tenantId: context.tenantId,
        createdByMemberId: context.memberId,
        deletedAt: null,
        ...(cursor && cursorDate
          ? {
              OR: [
                { lastMessageAt: { lt: cursorDate } },
                {
                  AND: [
                    { lastMessageAt: cursorDate },
                    { id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      };
      const rows = await tx.aiConversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const latestUsers = page.length
        ? await tx.aiMessage.findMany({
            where: {
              tenantId: context.tenantId,
              role: 'USER',
              conversationId: { in: page.map((row) => row.id) },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : [];
      const previewByConversation = new Map<string, string>();
      for (const message of latestUsers) {
        if (!previewByConversation.has(message.conversationId)) {
          previewByConversation.set(message.conversationId, message.content);
        }
      }
      const items = page.map((row) => ({
        id: row.id,
        title: row.title,
        lastMessageAt: row.lastMessageAt.toISOString(),
        latestUserPreview: previewByConversation.get(row.id) ?? null,
      }));
      return {
        items,
        nextCursor: hasMore
          ? encodeConversationCursor({
              lastMessageAt: items.at(-1)!.lastMessageAt,
              id: items.at(-1)!.id,
            })
          : undefined,
      };
    });
  }

  messages(
    context: TenantContext,
    conversationId: string,
    query: ConversationMessageQuery,
  ): Promise<ConversationMessagePage> {
    return this.runner.withTenant(context, async (tx) => {
      await requireOwnedConversation(tx, context, conversationId);
      const limit = pageLimit(query.limit);
      let olderThan:
        | { createdAt: Date; id: string }
        | undefined;
      if (query.before) {
        const pivot = await tx.aiMessage.findFirst({
          where: {
            id: query.before,
            tenantId: context.tenantId,
            conversationId,
          },
        });
        if (!pivot) {
          throw new ApiException('AI_CURSOR_INVALID', 400);
        }
        olderThan = { createdAt: pivot.createdAt, id: pivot.id };
      }
      const where: Prisma.AiMessageWhereInput = {
        tenantId: context.tenantId,
        conversationId,
        ...(olderThan
          ? {
              OR: [
                { createdAt: { lt: olderThan.createdAt } },
                {
                  AND: [
                    { createdAt: olderThan.createdAt },
                    { id: { lt: olderThan.id } },
                  ],
                },
              ],
            }
          : {}),
      };
      const rows = await tx.aiMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const chronological = [...page].reverse();
      return {
        items: chronological.map(toPublicMessage),
        nextBefore: hasMore ? chronological[0]?.id : undefined,
      };
    });
  }

  rename(
    context: TenantContext,
    conversationId: string,
    title: string,
  ): Promise<{ id: string; title: string; lastMessageAt: string }> {
    return this.runner.withTenant(context, async (tx) => {
      const conversation = await requireOwnedConversation(
        tx,
        context,
        conversationId,
      );
      const updated = await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { title },
      });
      return {
        id: updated.id,
        title: updated.title,
        lastMessageAt: updated.lastMessageAt.toISOString(),
      };
    });
  }

  remove(context: TenantContext, conversationId: string): Promise<void> {
    return this.runner.withTenant(context, async (tx) => {
      const result = await tx.aiConversation.updateMany({
        where: {
          id: conversationId,
          tenantId: context.tenantId,
          createdByMemberId: context.memberId,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      if (result.count !== 1) {
        throw new ApiException('AI_CONVERSATION_NOT_FOUND', 404);
      }
    });
  }

  beginTurn(
    context: TenantContext,
    input: BeginTurnInput,
  ): Promise<BeginTurnResult> {
    return this.runner.withTenant(context, async (tx) => {
      await lockActiveMember(tx, context);
      const now = new Date();
      await failStaleGenerating(tx, context, now);
      const existing = input.conversationId
        ? await requireOwnedConversation(tx, context, input.conversationId)
        : null;
      await rejectInProgress(tx, context);
      await enforceNewTurnRateLimit(tx, context, now);

      const conversation =
        existing ??
        (await tx.aiConversation.create({
          data: {
            tenantId: context.tenantId,
            createdByMemberId: context.memberId,
            title: deriveConversationTitle(input.content),
            lastMessageAt: now,
          },
        }));

      const turnId = randomUUID();
      const user = await tx.aiMessage.create({
        data: {
          tenantId: context.tenantId,
          conversationId: conversation.id,
          turnId,
          role: 'USER',
          status: 'COMPLETED',
          content: input.content,
          completedAt: now,
        },
      });
      const assistant = await tx.aiMessage.create({
        data: {
          tenantId: context.tenantId,
          conversationId: conversation.id,
          turnId,
          role: 'ASSISTANT',
          status: 'GENERATING',
          content: '',
          toolSummary: emptyJsonArray(),
          sourceSummary: emptyJsonArray(),
          providerUsage: emptyJsonObject(),
        },
      });
      if (existing) {
        await tx.aiConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now },
        });
      }
      return asTurnResult(conversation, user, assistant);
    });
  }

  retryTurn(context: TenantContext, turnId: string): Promise<BeginTurnResult> {
    return this.runner.withTenant(context, async (tx) => {
      await lockActiveMember(tx, context);
      const now = new Date();
      await failStaleGenerating(tx, context, now);

      const assistant = await tx.aiMessage.findFirst({
        where: {
          tenantId: context.tenantId,
          turnId,
          role: 'ASSISTANT',
          conversation: {
            ...memberConversationWhere(context),
            deletedAt: null,
          },
        },
      });
      if (!assistant) {
        throw new ApiException('AI_TURN_NOT_FOUND', 404);
      }
      if (assistant.status !== 'FAILED' && assistant.status !== 'CANCELLED') {
        throw new ApiException('AI_TURN_NOT_RETRYABLE', 409);
      }
      const user = await tx.aiMessage.findFirst({
        where: {
          tenantId: context.tenantId,
          conversationId: assistant.conversationId,
          turnId,
          role: 'USER',
        },
      });
      if (!user) {
        throw new ApiException('AI_TURN_NOT_FOUND', 404);
      }
      await rejectInProgress(tx, context, assistant.id);

      const reset = await tx.aiMessage.update({
        where: { id: assistant.id },
        data: {
          status: 'GENERATING',
          content: '',
          toolSummary: emptyJsonArray(),
          sourceSummary: emptyJsonArray(),
          providerUsage: emptyJsonObject(),
          errorCode: null,
          completedAt: null,
        },
      });
      const conversation = await requireOwnedConversation(
        tx,
        context,
        assistant.conversationId,
      );
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });
      return asTurnResult(conversation, user, reset);
    });
  }

  finalizeAssistant(
    context: TenantContext,
    turnId: string,
    outcome: AssistantFinalizeOutcome,
  ): Promise<void> {
    return this.runner.withTenant(context, async (tx) => {
      const assistant = await tx.aiMessage.findFirst({
        where: {
          tenantId: context.tenantId,
          turnId,
          role: 'ASSISTANT',
          conversation: {
            ...memberConversationWhere(context),
            deletedAt: null,
          },
        },
      });
      if (!assistant) {
        throw new ApiException('AI_TURN_NOT_FOUND', 404);
      }
      await tx.aiMessage.update({
        where: { id: assistant.id },
        data: {
          status: outcome.status,
          content: outcome.content,
          providerUsage: (outcome.usage ?? {}) as Prisma.InputJsonValue,
          errorCode: outcome.errorCode ?? null,
          completedAt: new Date(),
        },
      });
    });
  }
}
