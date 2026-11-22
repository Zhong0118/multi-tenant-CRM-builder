import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AssistantAnswerValue,
  AssistantPageHint,
  AssistantQuestion,
  FilterRule,
} from '@crm/contracts';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { resolveReadablePublishedObjectInTransaction } from '../objects/published-object-transaction';
import type {
  RecordsRepository,
  RecordsTransaction,
} from '../records/records.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import type { BeginTurnResult } from './ai.types';
import {
  asTurnResult,
  currentAuthorizationState,
  lockActiveMember,
  providerAttemptsOf,
  withProviderAttempts,
} from './conversation.repository';
import { answerSchema } from './dto/ai-turn.dto';
import {
  questionInput,
  type QuestionInput,
} from './tools/assistant-question.tool';
import {
  conflict,
  defaultPrompts,
  defineForm,
  invalid,
  projectQuestion,
  readPage,
  readTarget,
  verifyAnswer,
  visible,
  type RecordRef,
  type ResolvedAssistantPage,
  type QuestionDefinition,
  type VerifiedAnswer,
} from './assistant-question-data';
export type {
  ResolvedAssistantPage,
  VerifiedAnswer,
} from './assistant-question-data';
export type { QuestionInput } from './tools/assistant-question.tool';

type Tx = Prisma.TransactionClient;
type Source = 'page' | 'tool';
type ResumeResult = {
  turn: BeginTurnResult;
  answer: VerifiedAnswer;
  page?: ResolvedAssistantPage;
  filterDraft?: FilterRule;
  replay: boolean;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function lockConversation(tx: Tx, actor: TenantContext, id: string) {
  await lockActiveMember(tx, actor);
  const [conversation] = await tx.$queryRaw<{ id: string; title: string }[]>`
    SELECT id,title FROM ai_conversations WHERE tenant_id=${actor.tenantId}::uuid
      AND created_by_member_id=${actor.memberId}::uuid AND id=${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (!conversation) throw new ApiException('AI_CONVERSATION_NOT_FOUND', 404);
  return conversation;
}
async function lockQuestion(
  tx: Tx,
  actor: TenantContext,
  conversationId: string,
  id: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ai_questions WHERE tenant_id=${actor.tenantId}::uuid AND member_id=${actor.memberId}::uuid
      AND conversation_id=${conversationId}::uuid AND id=${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new ApiException('AI_TURN_NOT_FOUND', 404);
  return tx.aiQuestion.findUniqueOrThrow({ where: { id } });
}
const scope = (actor: TenantContext, conversationId: string) => ({
  tenantId: actor.tenantId,
  memberId: actor.memberId,
  conversationId,
});
async function storeEvidence(
  tx: Tx,
  actor: TenantContext,
  conversationId: string,
  messageId: string,
  turnId: string,
  refs: RecordRef[],
  source: Source,
) {
  if (refs.length)
    await tx.aiRecordEvidence.createMany({
      data: refs.map(({ objectCode, recordId }) => ({
        ...scope(actor, conversationId),
        messageId,
        turnId,
        objectCode,
        recordId,
        source,
      })),
      skipDuplicates: true,
    });
}
async function generating(tx: Tx, actor: TenantContext, turn: BeginTurnResult) {
  const assistant = await tx.aiMessage.findFirst({
    where: {
      id: turn.assistant.id,
      tenantId: actor.tenantId,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      role: 'ASSISTANT',
      status: 'GENERATING',
    },
  });
  if (
    !assistant ||
    providerAttemptsOf(assistant.providerUsage) !==
      providerAttemptsOf(turn.assistant.providerUsage)
  )
    return conflict();
  return assistant;
}

@Injectable()
export class AssistantQuestionsService {
  constructor(
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
  ) {}
  async resolvePage(actor: TenantContext, hint?: AssistantPageHint) {
    if (!hint) return undefined;
    return this.records.withTenantTransaction(actor, async (db) => {
      await lockActiveMember(db.tx, actor);
      return visible(() => readPage(db, actor, hint));
    });
  }
  async remember(
    actor: TenantContext,
    turn: BeginTurnResult,
    refs: RecordRef[],
    source: Source,
  ) {
    if (!refs.length) return;
    await this.records.withTenantTransaction(actor, async (db) => {
      await lockConversation(db.tx, actor, turn.conversationId);
      await generating(db.tx, actor, turn);
      if (source === 'page')
        for (const ref of refs) await readTarget(db, actor, ref);
      await storeEvidence(
        db.tx,
        actor,
        turn.conversationId,
        turn.assistant.id,
        turn.turnId,
        refs,
        source,
      );
    });
  }
  seen(actor: TenantContext, conversationId: string): Promise<RecordRef[]> {
    return this.records.withTenantTransaction(actor, ({ tx }) =>
      tx.aiRecordEvidence.findMany({
        where: scope(actor, conversationId),
        distinct: ['objectCode', 'recordId'],
        select: { objectCode: true, recordId: true },
      }),
    );
  }
  private async definition(
    db: RecordsTransaction,
    actor: TenantContext,
    conversationId: string,
    input: QuestionInput,
  ): Promise<QuestionDefinition> {
    if (input.kind === 'choose_option')
      return {
        kind: input.kind,
        options: input.options.map((label) => ({ id: randomUUID(), label })),
      };
    const recordIds =
      input.kind === 'fill_fields' ? [input.recordId] : input.recordIds;
    const evidence = await db.tx.aiRecordEvidence.findMany({
      where: {
        ...scope(actor, conversationId),
        objectCode: input.objectCode,
        recordId: { in: recordIds },
        ...(input.kind === 'choose_record' ? { source: 'tool' } : {}),
      },
      distinct: ['recordId'],
      select: { recordId: true },
    });
    if (evidence.length !== recordIds.length) return invalid();
    if (input.kind === 'fill_fields')
      return defineForm(db, actor, input, input.fieldKeys);
    const resolved = await resolveReadablePublishedObjectInTransaction(
      db.tx,
      actor,
      input.objectCode,
    );
    const options = [];
    for (const recordId of input.recordIds) {
      if (
        await visible(() =>
          readTarget(db, actor, { objectCode: input.objectCode, recordId }),
        )
      )
        options.push({ id: randomUUID(), recordId });
    }
    if (!options.length) return invalid();
    return {
      kind: input.kind,
      objectCode: input.objectCode,
      publicationId: resolved.schema.publication.id,
      options,
    };
  }
  open(
    actor: TenantContext,
    turn: BeginTurnResult,
    raw: QuestionInput,
    page?: ResolvedAssistantPage,
    filterDraft?: FilterRule,
  ): Promise<AssistantQuestion | null> {
    const parsed = questionInput.safeParse(raw);
    if (!parsed.success) return invalid();
    const input = parsed.data;
    return this.records.withTenantTransaction(actor, async (db) => {
      const { tx } = db;
      await lockConversation(tx, actor, turn.conversationId);
      const assistant = await generating(tx, actor, turn);
      if (
        (await tx.aiQuestion.count({ where: { messageId: assistant.id } })) >= 3
      )
        return null;
      const def = await this.definition(db, actor, turn.conversationId, input);
      if (page) {
        def.anchor = {
          objectCode: page.objectCode,
          ...(page.recordId ? { recordId: page.recordId } : {}),
          ...(page.viewId ? { viewId: page.viewId } : {}),
        };
        await readPage(db, actor, def.anchor);
        if (!page.recordId && filterDraft) def.filterDraft = filterDraft;
      }
      def.revision = (await currentAuthorizationState(tx, actor, true))
        ?.revision;
      const now = new Date();
      const row = await tx.aiQuestion.create({
        data: {
          ...scope(actor, turn.conversationId),
          turnId: turn.turnId,
          messageId: assistant.id,
          kind: input.kind,
          prompt:
            (input.kind === 'choose_option' ? input.prompt : undefined) ??
            defaultPrompts[input.kind],
          definition: json(def),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      // Finalization and question publication compete for this exact generation.
      const paused = await tx.aiMessage.updateMany({
        where: {
          id: assistant.id,
          status: 'GENERATING',
          providerUsage: { equals: json(assistant.providerUsage) },
        },
        data: { status: 'COMPLETED', completedAt: now, content: '' },
      });
      if (paused.count !== 1) return conflict();
      return (await projectQuestion(db, actor, row, def.revision)) ?? invalid();
    });
  }
  async resume(
    actor: TenantContext,
    conversationId: string,
    id: string,
    raw: AssistantAnswerValue,
  ): Promise<ResumeResult> {
    const parsed = answerSchema.safeParse(raw);
    if (!parsed.success) return invalid();
    const value = parsed.data;
    const result = await this.records.withTenantTransaction(
      actor,
      async (db) => {
        const { tx } = db;
        const conversation = await lockConversation(tx, actor, conversationId);
        const row = await lockQuestion(tx, actor, conversationId, id);
        const now = new Date();
        if (row.state === 'OPEN' && row.expiresAt <= now) {
          await tx.aiQuestion.update({
            where: { id },
            data: { state: 'EXPIRED', resolvedAt: now },
          });
          return null;
        }
        if (
          row.state !== 'OPEN' &&
          !(row.state === 'ANSWERED' && isDeepStrictEqual(row.answer, value))
        )
          return conflict();
        const assistant = await tx.aiMessage.findUniqueOrThrow({
          where: { id: row.messageId },
        });
        const user = await tx.aiMessage.findFirstOrThrow({
          where: {
            tenantId: actor.tenantId,
            conversationId,
            turnId: row.turnId,
            role: 'USER',
          },
        });
        const attempts = providerAttemptsOf(assistant.providerUsage);
        if (row.state === 'ANSWERED') {
          const latest = await tx.aiQuestion.findFirst({
            where: { messageId: row.messageId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          });
          const latestTurn = await tx.aiMessage.findFirst({
            where: { conversationId, role: 'USER' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { turnId: true },
          });
          const stale =
            assistant.status === 'GENERATING' &&
            assistant.updatedAt.getTime() +
              Number(process.env.AI_TIMEOUT_MS || 45000) +
              15000 <
              now.getTime();
          if (
            latest?.id !== id ||
            latestTurn?.turnId !== row.turnId ||
            (!stale && !['FAILED', 'CANCELLED'].includes(assistant.status))
          )
            return {
              turn: asTurnResult(conversation, user, assistant),
              answer: { kind: value.kind },
              replay: true,
            };
        }
        const def = row.definition as unknown as QuestionDefinition;
        const revision = (await currentAuthorizationState(tx, actor, true))
          ?.revision;
        let page: ResolvedAssistantPage | undefined;
        if (def.anchor) {
          page = await visible(() => readPage(db, actor, def.anchor!));
          if (!page) return conflict();
        }
        const answer = await verifyAnswer(db, actor, row, value, revision);
        answer.question = row.prompt;
        const previous = await tx.aiQuestion.findMany({
          where: {
            messageId: row.messageId,
            state: 'ANSWERED',
            id: { not: row.id },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (previous.length) {
          answer.previous = [];
          for (const old of previous) {
            const parsed = answerSchema.safeParse(old.answer);
            if (!parsed.success) return conflict();
            const prior = await verifyAnswer(
              db,
              actor,
              old,
              parsed.data,
              revision,
            );
            answer.previous.push({
              ...prior,
              question:
                old.kind === 'choose_option'
                  ? old.prompt
                  : defaultPrompts[prior.kind],
            });
          }
        }
        if (answer.objectCode && answer.recordId) {
          const ref = {
            objectCode: answer.objectCode,
            recordId: answer.recordId,
          };
          page = await readPage(db, actor, ref);
          await storeEvidence(
            tx,
            actor,
            conversationId,
            row.messageId,
            row.turnId,
            [ref],
            answer.kind === 'choose_record' ? 'tool' : 'page',
          );
        }
        if (row.state === 'OPEN')
          await tx.aiQuestion.update({
            where: { id },
            data: { state: 'ANSWERED', answer: json(value), resolvedAt: now },
          });
        const reset = await tx.aiMessage.update({
          where: { id: assistant.id },
          data: {
            status: 'GENERATING',
            content: '',
            completedAt: null,
            errorCode: null,
            providerUsage: withProviderAttempts(
              { authorizationRevision: revision },
              attempts + 1,
            ),
            toolSummary: [],
            sourceSummary: [],
          },
        });
        return {
          turn: asTurnResult(conversation, user, reset),
          answer,
          page,
          ...(def.filterDraft ? { filterDraft: def.filterDraft } : {}),
          replay: false,
        };
      },
    );
    return result ?? conflict();
  }
  async retryAnswer(
    actor: TenantContext,
    turnId: string,
  ): Promise<ResumeResult | undefined> {
    const latest = await this.records.withTenantTransaction(actor, ({ tx }) =>
      tx.aiQuestion.findFirst({
        where: { tenantId: actor.tenantId, memberId: actor.memberId, turnId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    if (!latest) return undefined;
    if (latest.state !== 'ANSWERED') return conflict();
    return this.resume(
      actor,
      latest.conversationId,
      latest.id,
      latest.answer as AssistantAnswerValue,
    );
  }
  cancel(actor: TenantContext, conversationId: string, id: string) {
    return this.records.withTenantTransaction(actor, async ({ tx }) => {
      await lockConversation(tx, actor, conversationId);
      const row = await lockQuestion(tx, actor, conversationId, id);
      if (row.state === 'CANCELLED') return;
      if (row.state !== 'OPEN') return conflict();
      const now = new Date();
      await tx.aiQuestion.update({
        where: { id },
        data: {
          state: row.expiresAt <= now ? 'EXPIRED' : 'CANCELLED',
          resolvedAt: now,
        },
      });
    });
  }
  async history(
    actor: TenantContext,
    conversationId: string,
    messageIds: string[],
  ) {
    const cards = new Map<string, AssistantQuestion[]>();
    if (!messageIds.length) return cards;
    return this.records.withTenantTransaction(actor, async (db) => {
      await lockConversation(db.tx, actor, conversationId);
      const where = {
        ...scope(actor, conversationId),
        messageId: { in: messageIds },
      };
      const now = new Date();
      await db.tx.aiQuestion.updateMany({
        where: { ...where, state: 'OPEN', expiresAt: { lte: now } },
        data: { state: 'EXPIRED', resolvedAt: now },
      });
      const rows = await db.tx.aiQuestion.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!rows.length) return cards;
      const revision = (await currentAuthorizationState(db.tx, actor, true))
        ?.revision;
      for (const row of rows) {
        const card = await projectQuestion(db, actor, row, revision);
        if (card)
          cards.set(row.messageId, [...(cards.get(row.messageId) ?? []), card]);
      }
      return cards;
    });
  }
}
