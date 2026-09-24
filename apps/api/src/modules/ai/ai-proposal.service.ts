import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import { validateCreateFollowUpInput } from '../follow-ups/follow-ups.service';
import { createFollowUpCommand } from '../follow-ups/follow-up-command';
import {
  isReadable,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import {
  createRecordActivityCommand,
  updateRecordCommand,
  validateRecordActivityInput,
} from '../records/record-command';
import {
  RecordValueError,
  validateRecordMutation,
} from '../records/record-value-engine';
import type { RecordsRepository } from '../records/records.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import { AiOperationRepository } from './ai-operation.repository';
import type { AiProposalDisplay, AiProposalView } from './ai-operation.types';
import {
  validateProposalCandidate,
  type ProposalCandidate,
} from './ai-proposal.schema';

type Tx = Prisma.TransactionClient;

function requireReadable(resolved: ResolvedObjectSchema): void {
  if (!isReadable(resolved.schema, resolved.access))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
function requireUpdatable(resolved: ResolvedObjectSchema): void {
  if (!resolved.access.canUpdate || resolved.access.updateScope === 'NONE')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
function ownerFor(
  resolved: ResolvedObjectSchema,
  context: TenantContext,
): string | null {
  return resolved.access.readScope === 'OWN' ||
    resolved.access.updateScope === 'OWN'
    ? context.memberId
    : null;
}
async function lockActor(tx: Tx, context: TenantContext): Promise<void> {
  const members = await tx.$queryRaw<
    Array<{ id: string; user_id: string; status: string; role: string }>
  >`
    SELECT id, user_id, status, role FROM tenant_members
    WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.memberId}::uuid FOR UPDATE`;
  if (
    members.length !== 1 ||
    members[0].user_id !== context.userId ||
    members[0].status !== 'ACTIVE' ||
    members[0].role !== context.role
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
function safeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return Array.isArray(value)
    ? value.slice(0, 20).map(safeText).join(', ').slice(0, 200)
    : '';
}
function safeValidation(error: unknown): never {
  // Never propagate fieldErrors/fieldKey, provider content, or raw database errors.
  if (
    error instanceof RecordValueError ||
    (error instanceof ApiException && error.getStatus() < 500)
  )
    throw new ApiException('VALIDATION_FAILED', 400);
  throw new ApiException('INTERNAL_ERROR', 500);
}

@Injectable()
export class AiProposalService {
  constructor(
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
    private readonly operations: AiOperationRepository,
    private readonly audit: AuditService,
  ) {}

  async preview(
    context: TenantContext,
    turnId: string,
    untrusted: unknown,
    requestText: string,
  ): Promise<AiProposalView> {
    let candidate: ProposalCandidate;
    try {
      candidate = validateProposalCandidate(untrusted);
    } catch {
      throw new ApiException('VALIDATION_FAILED', 400);
    }
    if (typeof requestText !== 'string')
      throw new ApiException('VALIDATION_FAILED', 400);
    const snapshot = await this.records.withTenantTransaction(
      context,
      async ({ tx, store }) => {
        await lockActor(tx, context);
        const resolved = await resolvePublishedObjectInTransaction(
          tx,
          context,
          candidate.objectCode,
        );
        requireReadable(resolved);
        requireUpdatable(resolved);
        const record = await store.lockRecord({
          objectId: resolved.schema.object.id,
          recordId: candidate.recordId,
          ownerMemberId: ownerFor(resolved, context),
        });
        if (
          !record ||
          (ownerFor(resolved, context) &&
            record.ownerMemberId !== context.memberId)
        )
          throw new ApiException('RECORD_NOT_FOUND', 404);
        const display: AiProposalDisplay = {
          title:
            candidate.operationType === 'UPDATE_RECORD'
              ? '修改记录'
              : candidate.operationType === 'CREATE_FOLLOW_UP'
                ? '创建跟进'
                : '添加备注',
          targetSummary: safeText(record.title),
          changes: [],
          validationWarnings: [],
        };
        try {
          if (candidate.operationType === 'UPDATE_RECORD') {
            const normalized = await validateRecordMutation({
              mode: 'UPDATE',
              schema: resolved.schema,
              access: resolved.access,
              current: record.values,
              submitted: candidate.values,
              memberExists: (memberId) => store.memberExists(memberId),
            });
            display.changes = Object.entries(candidate.values).map(([key]) => ({
              label: safeText(
                resolved.schema.fields.find((field) => field.fieldKey === key)
                  ?.label,
              ),
              before: safeText(record.values[key]),
              after: safeText(normalized.values[key]),
            }));
          } else if (candidate.operationType === 'CREATE_FOLLOW_UP') {
            const normalized = validateCreateFollowUpInput(candidate);
            display.changes = [
              { label: '标题', after: safeText(normalized.title) },
              { label: '到期时间', after: normalized.dueAt },
            ];
          } else {
            display.changes = [
              {
                label: 'NOTE',
                after: validateRecordActivityInput({
                  activityType: 'NOTE',
                  content: candidate.content,
                }),
              },
            ];
          }
        } catch (error) {
          safeValidation(error);
        }
        return { resolved, record, display };
      },
    );
    // Only operation persistence follows; no Record, Activity, Follow-up or Domain Audit write.
    return this.operations.createValidated(
      context,
      turnId,
      {
        conversationId: await this.conversationForTurn(context, turnId),
        operationType: candidate.operationType,
        requestText: requestText.slice(0, 4000),
        proposal: candidate as Prisma.InputJsonObject,
        targetRef: {
          objectCode: candidate.objectCode,
          recordId: candidate.recordId,
        },
        expectedVersion: snapshot.record.version,
        expectedPublicationId: snapshot.resolved.schema.publication.id,
      },
      snapshot.display,
    );
  }

  async get(
    context: TenantContext,
    proposalId: string,
  ): Promise<AiProposalView> {
    return this.records.withTenantTransaction(context, async ({ tx }) => {
      const locked = await this.operations.lockOwned(tx, context, proposalId);
      if (locked.kind === 'NOT_FOUND')
        throw new ApiException('AI_TURN_NOT_FOUND', 404);
      return locked.kind === 'PROPOSED'
        ? this.getAfterReject(tx, context, proposalId)
        : locked.view;
    });
  }

  async reject(
    context: TenantContext,
    proposalId: string,
  ): Promise<AiProposalView> {
    return this.records.withTenantTransaction(context, async ({ tx }) => {
      const locked = await this.operations.lockOwned(tx, context, proposalId);
      if (locked.kind === 'NOT_FOUND')
        throw new ApiException('AI_TURN_NOT_FOUND', 404);
      if (locked.kind !== 'PROPOSED') return locked.view;
      const changed = await tx.aiOperation.updateMany({
        where: {
          id: proposalId,
          tenantId: context.tenantId,
          requestedByMemberId: context.memberId,
          status: 'PROPOSED',
        },
        data: { status: 'REJECTED' },
      });
      if (changed.count !== 1) throw new ApiException('AI_TURN_NOT_FOUND', 404);
      return {
        ...(await this.getAfterReject(tx, context, proposalId)),
        status: 'REJECTED',
      };
    });
  }

  private async getAfterReject(
    tx: Tx,
    context: TenantContext,
    id: string,
  ): Promise<AiProposalView> {
    const row = await tx.aiOperation.findFirst({
      where: {
        id,
        tenantId: context.tenantId,
        requestedByMemberId: context.memberId,
      },
    });
    if (!row) throw new ApiException('AI_TURN_NOT_FOUND', 404);
    const display = row.displayChangesJson as unknown as AiProposalDisplay;
    return {
      ...display,
      proposalId: id,
      operation: row.operationType,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      failureCode: row.failureCode,
      auditId: row.auditId,
      result: row.resultJson,
    };
  }

  async confirm(
    context: TenantContext,
    proposalId: string,
    idempotencyKey: string,
    requestMeta: { requestId: string; ip?: string },
  ): Promise<AiProposalView> {
    // Idempotency is by locked proposal ID, including attempts carrying a new key.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    try {
      return await this.records.withTenantTransaction(
        context,
        async ({ tx, store }) => {
          const locked = await this.operations.lockOwned(
            tx,
            context,
            proposalId,
          );
          if (locked.kind === 'NOT_FOUND')
            throw new ApiException('AI_TURN_NOT_FOUND', 404);
          if (locked.kind !== 'PROPOSED') return locked.view; // Expiration must COMMIT, not throw.
          await lockActor(tx, context);
          const row = locked.operation;
          let candidate: ProposalCandidate;
          try {
            candidate = validateProposalCandidate(row.proposalJson);
          } catch {
            throw new ApiException('VALIDATION_FAILED', 400);
          }
          if (row.operationType !== candidate.operationType)
            throw new ApiException('VALIDATION_FAILED', 400);
          // Stabilize publication and effective member override for the whole mutation.
          await tx.$queryRaw`SELECT id FROM object_definitions WHERE tenant_id=${context.tenantId}::uuid AND code=${candidate.objectCode} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM object_permissions WHERE tenant_id=${context.tenantId}::uuid AND object_id=(SELECT id FROM object_definitions WHERE tenant_id=${context.tenantId}::uuid AND code=${candidate.objectCode}) AND subject_member_id=${context.memberId}::uuid FOR UPDATE`;
          const resolved = await resolvePublishedObjectInTransaction(
            tx,
            context,
            candidate.objectCode,
          );
          requireReadable(resolved);
          requireUpdatable(resolved);
          if (resolved.schema.publication.id !== row.expectedPublicationId)
            throw new ApiException('RECORD_VERSION_CONFLICT', 409);
          const ownerMemberId = ownerFor(resolved, context);
          const record = await store.lockRecord({
            objectId: resolved.schema.object.id,
            recordId: candidate.recordId,
            ownerMemberId,
          });
          if (
            !record ||
            (ownerMemberId && record.ownerMemberId !== context.memberId)
          )
            throw new ApiException('RECORD_NOT_FOUND', 404);
          if (record.version !== row.expectedVersion)
            throw new ApiException('RECORD_VERSION_CONFLICT', 409);
          const meta = {
            ...requestMeta,
            actionAudit: { aiOperationId: proposalId },
          };
          let auditId: string;
          let result: Prisma.InputJsonObject;
          if (candidate.operationType === 'UPDATE_RECORD') {
            const executed = await updateRecordCommand({
              store,
              resolved,
              context,
              recordId: candidate.recordId,
              input: { version: row.expectedVersion, values: candidate.values },
              meta,
            });
            auditId = executed.auditId;
            result = {
              objectCode: candidate.objectCode,
              recordId: candidate.recordId,
            };
          } else if (candidate.operationType === 'ADD_ACTIVITY_NOTE') {
            const executed = await createRecordActivityCommand({
              store,
              resolved,
              context,
              recordId: candidate.recordId,
              input: { activityType: 'NOTE', content: candidate.content },
              meta,
              clock: () => new Date(),
              idGenerator: randomUUID,
            });
            auditId = executed.auditId;
            result = {
              objectCode: candidate.objectCode,
              recordId: candidate.recordId,
              activityId: executed.activity.id,
            };
          } else {
            const validated = validateCreateFollowUpInput(candidate);
            let generatedAuditId: string | undefined;
            const item = await createFollowUpCommand(
              tx,
              context,
              { recordId: candidate.recordId, ...validated },
              meta,
              {
                objectId: resolved.schema.object.id,
                recordId: candidate.recordId,
                expectedRole: context.role,
                requiredOwnerMemberId: ownerMemberId ?? undefined,
              },
              {
                audit: this.audit,
                onAuditId: (id) => {
                  generatedAuditId = id;
                },
              },
            );
            if (!generatedAuditId)
              throw new ApiException('INTERNAL_ERROR', 500);
            auditId = generatedAuditId;
            result = {
              objectCode: candidate.objectCode,
              recordId: candidate.recordId,
              followUpId: item.id,
            };
          }
          await this.operations.markExecuted(
            tx,
            context,
            proposalId,
            auditId,
            result,
          );
          return {
            ...(await this.getAfterReject(tx, context, proposalId)),
            status: 'EXECUTED',
            result: result as Prisma.JsonObject,
            auditId,
          };
        },
      );
    } catch (error) {
      if (error instanceof ApiException && error.code === 'AI_TURN_NOT_FOUND')
        throw error;
      // The command transaction has rolled back. Never persist failure in it or
      // expose raw DB/provider exceptions; the conditional transition is separate.
      const state =
        error instanceof ApiException &&
        [403, 404, 409].includes(error.getStatus())
          ? 'CONFLICTED'
          : 'FAILED';
      const code =
        error instanceof ApiException && error.getStatus() < 500
          ? error.code
          : 'INTERNAL_ERROR';
      const final = await this.operations.markFailureIfProposed(
        context,
        proposalId,
        state,
        code,
      );
      if (!final) throw new ApiException('AI_TURN_NOT_FOUND', 404);
      return final;
    }
  }

  private async conversationForTurn(
    context: TenantContext,
    turnId: string,
  ): Promise<string> {
    return this.records.withTenantTransaction(context, async ({ tx }) => {
      const turn = await tx.aiMessage.findFirst({
        where: {
          tenantId: context.tenantId,
          turnId,
          role: 'USER',
          conversation: {
            createdByMemberId: context.memberId,
            deletedAt: null,
          },
        },
        select: { conversationId: true },
      });
      if (!turn) throw new ApiException('AI_TURN_NOT_FOUND', 404);
      return turn.conversationId;
    });
  }
}
