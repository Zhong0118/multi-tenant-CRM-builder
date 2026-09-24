import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type {
  AiOperationRow,
  AiProposalDisplay,
  AiProposalView,
  LockedAiOperation,
  ValidatedAiOperation,
} from './ai-operation.types';

type Tx = Prisma.TransactionClient;

function ownedWhere(context: TenantContext) {
  return {
    tenantId: context.tenantId,
    requestedByMemberId: context.memberId,
    conversation: {
      tenantId: context.tenantId,
      createdByMemberId: context.memberId,
      deletedAt: null,
    },
    requester: {
      tenantId: context.tenantId,
      userId: context.userId,
      status: 'ACTIVE' as const,
    },
  };
}

function toView(row: AiOperationRow): AiProposalView {
  // Only the server-validated, sanitized display is projected. In particular,
  // proposalJson and requestText never leave the repository read methods.
  const display = row.displayChangesJson as unknown as AiProposalDisplay;
  return {
    proposalId: row.id,
    operation: row.operationType,
    title: display.title,
    targetSummary: display.targetSummary,
    changes: display.changes,
    validationWarnings: display.validationWarnings ?? [],
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    failureCode: row.failureCode,
    result: row.resultJson,
    auditId: row.auditId,
  };
}

@Injectable()
export class AiOperationRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  createValidated(
    context: TenantContext,
    turnId: string,
    candidate: ValidatedAiOperation,
    display: AiProposalDisplay,
  ): Promise<AiProposalView> {
    return this.runner.withTenant(context, (tx) =>
      this.createValidatedInTransaction(
        tx,
        context,
        turnId,
        candidate,
        display,
      ),
    );
  }

  async createValidatedInTransaction(
    tx: Tx,
    context: TenantContext,
    turnId: string,
    candidate: ValidatedAiOperation,
    display: AiProposalDisplay,
  ): Promise<AiProposalView> {
    const conversation = await tx.aiConversation.findFirst({
      where: {
        id: candidate.conversationId,
        tenantId: context.tenantId,
        createdByMemberId: context.memberId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!conversation) throw new ApiException('AI_CONVERSATION_NOT_FOUND', 404);
    const turn = await tx.aiMessage.findFirst({
      where: {
        tenantId: context.tenantId,
        conversationId: candidate.conversationId,
        turnId,
        role: 'USER',
      },
      select: { id: true },
    });
    if (!turn) throw new ApiException('AI_TURN_NOT_FOUND', 404);
    // The same DB clock instant supplies both persisted columns, regardless of caller clock.
    const [{ created_at: createdAt }] = await tx.$queryRaw<
      Array<{ created_at: Date }>
    >`SELECT CURRENT_TIMESTAMP AS created_at`;
    const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
    const row = await tx.aiOperation.create({
      data: {
        createdAt,
        tenantId: context.tenantId,
        conversationId: candidate.conversationId,
        turnId,
        requestedByMemberId: context.memberId,
        operationType: candidate.operationType,
        requestText: candidate.requestText,
        proposalJson: candidate.proposal,
        targetRefJson: candidate.targetRef,
        displayChangesJson: display as unknown as Prisma.InputJsonObject,
        expectedVersion: candidate.expectedVersion,
        expectedPublicationId: candidate.expectedPublicationId,
        expiresAt,
      },
    });
    return toView(row);
  }

  getOwned(context: TenantContext, id: string): Promise<AiProposalView | null> {
    return this.runner.withTenant(context, async (tx) => {
      const row = await tx.aiOperation.findFirst({
        where: { id, ...ownedWhere(context) },
      });
      return row ? toView(row) : null;
    });
  }

  listForTurns(
    context: TenantContext,
    conversationId: string,
    turnIds: string[],
  ): Promise<AiProposalView[]> {
    if (turnIds.length === 0) return Promise.resolve([]);
    return this.runner.withTenant(context, async (tx) =>
      (
        await this.listForTurnsInTransaction(
          tx,
          context,
          conversationId,
          turnIds,
        )
      ).map((item) => item.view),
    );
  }

  async listForTurnsInTransaction(
    tx: Tx,
    context: TenantContext,
    conversationId: string,
    turnIds: string[],
  ): Promise<Array<{ turnId: string; view: AiProposalView }>> {
    if (turnIds.length === 0) return [];
    const rows = await tx.aiOperation.findMany({
      where: {
        ...ownedWhere(context),
        conversationId,
        turnId: { in: turnIds },
      },
    });
    return rows.map((row) => ({
      turnId: row.turnId,
      view: toView(
        row.expiresAt.getTime() <= Date.now() && row.status === 'PROPOSED'
          ? { ...row, status: 'EXPIRED' }
          : row,
      ),
    }));
  }

  async lockOwned(
    tx: Tx,
    context: TenantContext,
    id: string,
  ): Promise<LockedAiOperation> {
    // Lock all authorization dependencies, not just the operation: revocation
    // or soft-delete cannot pass between authorization and domain mutation.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT o.id FROM ai_operations o
      JOIN ai_conversations c ON c.tenant_id = o.tenant_id AND c.id = o.conversation_id
      JOIN tenant_members m ON m.tenant_id = o.tenant_id AND m.id = o.requested_by_member_id
      WHERE o.tenant_id = ${context.tenantId}::uuid
        AND o.id = ${id}::uuid
        AND o.requested_by_member_id = ${context.memberId}::uuid
        AND c.created_by_member_id = ${context.memberId}::uuid
        AND c.deleted_at IS NULL
        AND m.user_id = ${context.userId}::uuid
        AND m.status = 'ACTIVE'
      FOR UPDATE OF o, c, m
    `;
    if (locked.length !== 1) return { kind: 'NOT_FOUND' };
    const row = await tx.aiOperation.findFirst({
      where: { id, ...ownedWhere(context) },
    });
    if (!row) return { kind: 'NOT_FOUND' };
    if (row.status === 'EXECUTED')
      return { kind: 'EXECUTED', result: row.resultJson, view: toView(row) };
    if (row.status !== 'PROPOSED')
      return { kind: 'TERMINAL', view: toView(row) };
    if (row.expiresAt.getTime() <= Date.now()) {
      const updated = await tx.aiOperation.updateMany({
        where: {
          id,
          tenantId: context.tenantId,
          requestedByMemberId: context.memberId,
          status: 'PROPOSED',
        },
        data: { status: 'EXPIRED' },
      });
      if (updated.count !== 1) throw new ApiException('AI_TURN_NOT_FOUND', 404);
      return { kind: 'EXPIRED', view: toView({ ...row, status: 'EXPIRED' }) };
    }
    return { kind: 'PROPOSED', operation: row };
  }

  async markExecuted(
    tx: Tx,
    context: TenantContext,
    id: string,
    auditId: string,
    result: Prisma.InputJsonValue,
  ): Promise<void> {
    const updated = await tx.aiOperation.updateMany({
      where: {
        id,
        tenantId: context.tenantId,
        requestedByMemberId: context.memberId,
        status: 'PROPOSED',
        conversation: { deletedAt: null, createdByMemberId: context.memberId },
      },
      data: {
        status: 'EXECUTED',
        auditId,
        resultJson: result,
        confirmedByMemberId: context.memberId,
        confirmedAt: new Date(),
        executedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new ApiException('AI_TURN_NOT_FOUND', 404);
  }

  markFailureIfProposed(
    context: TenantContext,
    id: string,
    state: 'CONFLICTED' | 'FAILED' | 'REJECTED',
    code: string,
  ): Promise<AiProposalView | null> {
    return this.runner.withTenant(context, async (tx) => {
      await tx.aiOperation.updateMany({
        where: {
          id,
          status: 'PROPOSED',
          ...ownedWhere(context),
        },
        data: {
          status: state,
          failureCode: code,
          confirmedByMemberId: context.memberId,
          confirmedAt: new Date(),
        },
      });
      // A competing confirm/reject may have committed first: return its actual
      // terminal status rather than pretending our conditional update won.
      const row = await tx.aiOperation.findFirst({
        where: { id, ...ownedWhere(context) },
      });
      return row ? toView(row) : null;
    });
  }
}
