import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { AiProposalService } from './ai-proposal.service';
import { validateProposalCandidate } from './ai-proposal.schema';
import { CommunicationDraftGenerator } from './communication-draft-generator';
import {
  itemKeys,
  type CommunicationDraftResponseDto,
  type CommunicationResultDto,
  type CreateCommunicationDraftDto,
  type DraftSelectionDto,
} from './dto/communication-draft.dto';

type Context = Awaited<ReturnType<CommunicationDraftGenerator['context']>>;
type Output = Awaited<ReturnType<CommunicationDraftGenerator['generate']>>;
type SavedOutput = {
  visibleFieldKeys: string[];
  content: Output;
  previousValues?: Record<string, unknown>;
  errorCode?: string;
};
type Meta = { requestId: string; ip?: string };
const failureEvent = 'ai.communication_item_failed';
const generationLeaseMs = 90_000;
const draftLifetimeMs = 24 * 60 * 60 * 1000;

function invalid() {
  return new ApiException('VALIDATION_FAILED', 400);
}
function candidate(
  objectCode: string,
  recordId: string,
  selection: DraftSelectionDto,
  draft: CommunicationDraftResponseDto,
) {
  const target = { objectCode, recordId };
  const { itemKey, editedValue } = selection;
  if (itemKey === 'note')
    return validateProposalCandidate({
      ...target,
      operationType: 'ADD_ACTIVITY_NOTE',
      content: editedValue,
    });
  if (
    !editedValue ||
    typeof editedValue !== 'object' ||
    Array.isArray(editedValue)
  )
    throw invalid();
  const values = editedValue as Record<string, unknown>;
  if (
    itemKey === 'followUp' &&
    draft.followUp &&
    Object.keys(values).every((k) => k === 'title' || k === 'dueAt')
  ) {
    return validateProposalCandidate({
      ...target,
      operationType: 'CREATE_FOLLOW_UP',
      title: values.title,
      dueAt: values.dueAt,
    });
  }
  if (
    itemKey !== 'fields' ||
    Object.keys(values).length !== 1 ||
    !values.values ||
    typeof values.values !== 'object' ||
    Array.isArray(values.values)
  )
    throw invalid();
  const allowed = new Set(draft.fieldChanges.map((f) => f.fieldKey));
  if (Object.keys(values.values).some((key) => !allowed.has(key)))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  return validateProposalCandidate({
    ...target,
    operationType: 'UPDATE_RECORD',
    values: values.values,
  });
}

@Injectable()
export class CommunicationDraftsService {
  constructor(
    private readonly db: DatabaseContextRunner,
    private readonly generator: CommunicationDraftGenerator,
    private readonly proposals: AiProposalService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: TenantContext,
    code: string,
    recordId: string,
    input: CreateCommunicationDraftDto,
  ) {
    const current = await this.generator.context(actor, code, recordId);
    const now = new Date();
    const key = {
      tenantId: actor.tenantId,
      memberId: actor.memberId,
      recordId,
      requestId: input.requestId,
    };
    const { id, claimed, lease } = await this.db.withTenant(
      actor,
      async (tx) => {
        const data = {
          ...key,
          id: randomUUID(),
          objectId: current.objectId,
          publicationId: current.publicationId,
          expectedVersion: current.expectedVersion,
          text: input.text,
          expiresAt: new Date(+now + draftLifetimeMs),
          updatedAt: now,
        };
        const inserted = await tx.aiRecordDraft.createMany({
          data,
          skipDuplicates: true,
        });
        if (inserted.count) return { id: data.id, claimed: true, lease: now };
        const existing = await tx.aiRecordDraft.findFirstOrThrow({
          where: key,
        });
        if (
          existing.objectId !== current.objectId ||
          existing.text !== input.text
        )
          throw new ApiException('RECORD_VERSION_CONFLICT', 409);
        if (existing.expiresAt <= now)
          throw new ApiException('AI_TURN_NOT_FOUND', 404);
        if (
          !existing.output &&
          +existing.updatedAt < +now - generationLeaseMs
        ) {
          const claim = await tx.aiRecordDraft.updateMany({
            where: {
              ...key,
              id: existing.id,
              updatedAt: existing.updatedAt,
              output: { equals: Prisma.DbNull },
            },
            data: { updatedAt: now },
          });
          return { id: existing.id, claimed: claim.count === 1, lease: now };
        }
        return { id: existing.id, claimed: false, lease: existing.updatedAt };
      },
    );
    if (claimed) {
      let output: SavedOutput;
      try {
        const content = await this.generator.generate(current, input.text);
        output = {
          visibleFieldKeys: current.visibleFieldKeys,
          content,
          previousValues: Object.fromEntries(
            (content.fieldChanges ?? []).map((change) => [
              change.fieldKey,
              current.fields.find((field) => field.fieldKey === change.fieldKey)
                ?.oldValue ?? null,
            ]),
          ),
        };
      } catch (error) {
        output = {
          visibleFieldKeys: [],
          content: { note: input.text, fieldChanges: [] },
          errorCode:
            error instanceof ApiException &&
            error.code === 'AI_PROVIDER_TIMEOUT'
              ? error.code
              : 'AI_PROVIDER_UNAVAILABLE',
        };
      }
      await this.db.withTenant(actor, (tx) =>
        tx.aiRecordDraft.updateMany({
          where: {
            ...key,
            id,
            updatedAt: lease,
            output: { equals: Prisma.DbNull },
          },
          data: { output: output as unknown as Prisma.InputJsonObject },
        }),
      );
    }
    return this.get(actor, code, recordId, id);
  }

  async get(
    actor: TenantContext,
    code: string,
    recordId: string,
    id: string,
  ): Promise<CommunicationDraftResponseDto> {
    const current = await this.generator.context(actor, code, recordId);
    return this.load(actor, current, id);
  }

  private async load(
    actor: TenantContext,
    current: Context,
    id: string,
  ): Promise<CommunicationDraftResponseDto> {
    return this.db.withTenant(actor, async (tx) => {
      const draft = await tx.aiRecordDraft.findFirst({
        where: {
          tenantId: actor.tenantId,
          memberId: actor.memberId,
          id,
          objectId: current.objectId,
          recordId: current.recordId,
          expiresAt: { gt: new Date() },
        },
      });
      if (!draft) throw new ApiException('AI_TURN_NOT_FOUND', 404);
      const saved = draft.output as unknown as SavedOutput | null;
      if (
        saved?.visibleFieldKeys.some(
          (k) => !current.visibleFieldKeys.includes(k),
        )
      )
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      const results = new Map<string, CommunicationResultDto>();
      const failures = await tx.auditLog.findMany({
        where: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: failureEvent,
          resourceId: id,
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['reason'],
        select: { id: true, reason: true, after: true },
      });
      for (const f of failures) {
        const itemKey = itemKeys.find((k) => k === f.reason);
        if (itemKey) {
          const after = f.after as { code?: string } | null;
          results.set(itemKey, {
            itemKey,
            status: 'FAILED',
            errorCode: after?.code ?? 'VALIDATION_FAILED',
            auditId: f.id,
          });
        }
      }
      const ops = await tx.aiOperation.findMany({
        where: {
          tenantId: actor.tenantId,
          requestedByMemberId: actor.memberId,
          draftId: id,
        },
        select: {
          draftItemKey: true,
          resultJson: true,
          status: true,
          auditId: true,
          failureCode: true,
        },
      });
      for (const op of ops) {
        const itemKey = itemKeys.find((k) => k === op.draftItemKey);
        if (!itemKey || op.status === 'PROPOSED') continue;
        const item: CommunicationResultDto = {
          itemKey,
          status: op.status === 'EXECUTED' ? 'EXECUTED' : 'FAILED',
          auditId: op.auditId,
          errorCode: op.failureCode,
        };
        const ref = op.resultJson;
        if (
          op.status === 'EXECUTED' &&
          ref &&
          typeof ref === 'object' &&
          !Array.isArray(ref)
        ) {
          const identity = {
            tenantId: actor.tenantId,
            recordId: current.recordId,
          };
          if (itemKey === 'note' && typeof ref.activityId === 'string') {
            item.activity =
              (await tx.recordActivity.findFirst({
                where: {
                  ...identity,
                  id: ref.activityId,
                  activityType: 'NOTE',
                },
                select: { id: true, content: true },
              })) ?? undefined;
          }
          if (itemKey === 'followUp' && typeof ref.followUpId === 'string') {
            const task = await tx.recordFollowUp.findFirst({
              where: {
                ...identity,
                id: ref.followUpId,
                ...(actor.role === 'TENANT_ADMIN'
                  ? {}
                  : { assigneeMemberId: actor.memberId }),
              },
              select: { id: true, title: true, dueAt: true },
            });
            if (task)
              item.followUp = { ...task, dueAt: task.dueAt.toISOString() };
          }
        }
        results.set(itemKey, item);
      }
      const content = saved?.content;
      return {
        id,
        requestId: draft.requestId,
        text: draft.text,
        timeZone: current.timeZone,
        status: !saved ? 'PENDING' : saved.errorCode ? 'FALLBACK' : 'READY',
        errorCode: saved?.errorCode,
        note: content?.note ?? draft.text,
        followUp: content?.followUp ?? undefined,
        fieldChanges: (content?.fieldChanges ?? []).flatMap((change) => {
          const field = current.fields.find(
            (f) => f.fieldKey === change.fieldKey,
          );
          return field
            ? [
                {
                  ...field,
                  oldValue: saved?.previousValues?.[change.fieldKey] ?? null,
                  value: change.value,
                  evidence: change.evidence,
                },
              ]
            : [];
        }),
        results: itemKeys.flatMap((key) =>
          results.has(key) ? [results.get(key)!] : [],
        ),
      };
    });
  }

  async confirm(
    actor: TenantContext,
    code: string,
    recordId: string,
    id: string,
    items: DraftSelectionDto[],
    meta: Meta,
  ) {
    const draft = await this.get(actor, code, recordId, id);
    if (draft.status === 'PENDING')
      throw new ApiException('AI_MEMBER_TURN_IN_PROGRESS', 409);
    for (const itemKey of itemKeys) {
      const item = items.find((i) => i.itemKey === itemKey);
      if (
        !item ||
        draft.results.some(
          (r) => r.itemKey === itemKey && r.status === 'EXECUTED',
        )
      )
        continue;
      let proposed;
      try {
        proposed = candidate(code, recordId, item, draft);
      } catch (error) {
        await this.recordFailure(
          actor,
          id,
          itemKey,
          error instanceof ApiException ? error.code : 'VALIDATION_FAILED',
          meta,
        );
        continue;
      }
      try {
        await this.proposals.executeDraftItem(
          actor,
          {
            draftId: id,
            itemKey,
            candidate: proposed,
            requestText: draft.text,
          },
          meta,
        );
      } catch (error) {
        if (!(error instanceof ApiException)) throw error;
        await this.recordFailure(actor, id, itemKey, error.code, meta);
      }
    }
    return this.get(actor, code, recordId, id);
  }

  private recordFailure(
    actor: TenantContext,
    id: string,
    itemKey: string,
    code: string,
    meta: Meta,
  ) {
    return this.db.withTenant(actor, (tx) =>
      this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorType: 'USER',
        actorId: actor.userId,
        action: failureEvent,
        resourceType: 'ai_record_draft',
        resourceId: id,
        reason: itemKey,
        after: { code },
        ...meta,
      }),
    );
  }
}
