import { modelFields } from './model-fields';
import { validateProposalCandidate } from './ai-proposal.schema';
import { isGroupPeer, recordFieldAccess } from '../objects/effective-access';
import {
  recordOwnerFilter,
  recordOwnerMatches,
} from '../objects/record-read-scope';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { API_ERROR_MESSAGES } from '../../common/errors/api-error-code';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import {
  isReadable,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { FollowUpsRepository } from '../follow-ups/follow-ups.repository';
import type { PublishedField } from '../objects/object-schema';
import { selectOptions } from '../records/record-value-engine';
import { visibleRecordIdsInTransaction } from '../records/record-visibility';
import type {
  AiOperationRow,
  AiProposalBatch,
  StoredAiProposalDisplay,
  AiProposalView,
  LockedAiOperation,
  ValidatedAiOperation,
  AiFieldFailureCode,
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

type HistoryItem = {
  turnId: string;
  view: AiProposalView;
  coverage?: AiProposalBatch['coverage'];
};

export function groupProposalBatches(rows: HistoryItem[]) {
  const batches = new Map<string, AiProposalBatch>();
  for (const { turnId, view, coverage } of rows) {
    const batch = batches.get(turnId) ?? { items: [] };
    batch.items.push(view);
    if (coverage) batch.coverage = coverage;
    batches.set(turnId, batch);
  }
  // A previously visible target may now be redacted. Avoid replaying old counts.
  for (const batch of batches.values()) {
    if (batch.items.some((item) => !item.changes.length)) delete batch.coverage;
  }
  return batches;
}

function editableFields(
  row: AiOperationRow,
  resolved: ResolvedObjectSchema,
): AiProposalView['editableFields'] {
  let candidate;
  try {
    candidate = validateProposalCandidate(row.proposalJson);
  } catch {
    return [];
  }
  if (candidate.operationType === 'ADD_ACTIVITY_NOTE')
    return [
      {
        key: 'content',
        label: '备注',
        type: 'TEXTAREA',
        value: candidate.content,
      },
    ];
  if (candidate.operationType === 'CREATE_FOLLOW_UP')
    return [
      { key: 'title', label: '标题', type: 'TEXT', value: candidate.title },
      {
        key: 'dueAt',
        label: '到期时间',
        type: 'DATETIME',
        value: candidate.dueAt,
      },
    ];
  return modelFields(resolved, resolved.access.fields)
    .filter(({ field }) => Object.hasOwn(candidate.values, field.fieldKey))
    .map(({ metadata }) => ({
      key: metadata.fieldKey,
      label: metadata.label,
      type: metadata.type,
      value: candidate.values[metadata.fieldKey],
      ...(metadata.options
        ? {
            options: metadata.options.map(({ key, label }) => ({
              id: key,
              label,
            })),
          }
        : {}),
    }));
}

function displayValue(value: string, field?: PublishedField): string {
  if (
    !value ||
    (field?.type !== 'SINGLE_SELECT' && field?.type !== 'MULTI_SELECT')
  )
    return value;
  const labels = new Map(
    selectOptions(field).map((option) => [option.key, option.label]),
  );
  // Historical multi-select snapshots store comma-separated option keys.
  const keys = field.type === 'MULTI_SELECT' ? value.split(/,\s*/) : [value];
  return keys.map((key) => labels.get(key) ?? '选项已不可用').join('、');
}

function toView(
  row: AiOperationRow,
  resolved: ResolvedObjectSchema | null,
  recordReadable: boolean,
  recordEditable = false,
  followUpReadable = true,
): AiProposalView {
  const display = row.displayChangesJson as unknown as StoredAiProposalDisplay;
  const fieldErrors: Record<string, string[]> = {};
  if (
    row.status === 'FAILED' &&
    row.operationType === 'UPDATE_RECORD' &&
    recordReadable &&
    recordEditable &&
    resolved?.access.canUpdate &&
    resolved.access.updateScope !== 'NONE' &&
    display &&
    typeof display.failureFieldCodes === 'object' &&
    display.failureFieldCodes !== null &&
    !Array.isArray(display.failureFieldCodes)
  ) {
    for (const [fieldKey, code] of Object.entries(
      display.failureFieldCodes,
    ).slice(0, 50)) {
      if (
        !Object.hasOwn(display.failureFieldCodes, fieldKey) ||
        fieldKey.length > 120 ||
        ['__proto__', 'constructor', 'prototype'].includes(fieldKey) ||
        !Object.hasOwn(resolved?.access.fields ?? {}, fieldKey)
      )
        continue;
      if (
        resolved?.schema.fields.some((field) => field.fieldKey === fieldKey) &&
        resolved.access.fields[fieldKey] === 'EDIT' &&
        (code === 'FIELD_REQUIRED' ||
          code === 'FIELD_INVALID' ||
          code === 'FIELD_OPTION_INACTIVE')
      ) {
        fieldErrors[fieldKey] = [
          API_ERROR_MESSAGES[code as keyof typeof API_ERROR_MESSAGES],
        ];
      }
    }
  }
  const titleReadable =
    recordReadable &&
    typeof display.titleFieldKey === 'string' &&
    resolved?.schema.fields.some(
      (field) => field.fieldKey === display.titleFieldKey,
    ) &&
    (resolved.access.fields[display.titleFieldKey] ?? 'HIDDEN') !== 'HIDDEN';
  const changes =
    recordReadable && followUpReadable
      ? display.changes.flatMap((change) => {
          const field =
            row.operationType === 'UPDATE_RECORD' && change.fieldKey
              ? resolved?.schema.fields.find(
                  (f) => f.fieldKey === change.fieldKey,
                )
              : undefined;
          if (
            row.operationType === 'UPDATE_RECORD' &&
            (!field ||
              (resolved?.access.fields[field.fieldKey] ?? 'HIDDEN') ===
                'HIDDEN')
          )
            return [];
          return [
            {
              label:
                row.operationType === 'ADD_ACTIVITY_NOTE'
                  ? '沟通纪要'
                  : (field?.label ?? change.label),
              ...(change.before === undefined
                ? {}
                : { before: displayValue(change.before, field) }),
              ...(change.after === undefined
                ? {}
                : { after: displayValue(change.after, field) }),
            },
          ];
        })
      : [];
  return {
    proposalId: row.id,
    ...(recordReadable &&
    recordEditable &&
    resolved &&
    row.status === 'PROPOSED'
      ? { editableFields: editableFields(row, resolved) }
      : {}),
    operation: row.operationType,
    title: display.title,
    targetSummary: titleReadable ? display.targetSummary : '',
    changes,
    validationWarnings: display.validationWarnings ?? [],
    fieldErrors,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    failureCode: row.failureCode,
    result: recordReadable && followUpReadable ? row.resultJson : null,
    auditId: row.auditId,
  };
}

@Injectable()
export class AiOperationRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly followUps: FollowUpsRepository,
  ) {}

  async projectInTransaction(
    tx: Tx,
    context: TenantContext,
    row: AiOperationRow,
  ): Promise<AiProposalView> {
    return (await this.projectRowsInTransaction(tx, context, [row]))[0];
  }

  private async projectRowsInTransaction(
    tx: Tx,
    context: TenantContext,
    rows: AiOperationRow[],
  ): Promise<AiProposalView[]> {
    const targets = rows.map(
      (row) =>
        (row.targetRefJson ?? {}) as {
          objectCode?: string;
          recordId?: string;
        },
    );
    const visibility = new Map<
      string,
      {
        resolved: ResolvedObjectSchema;
        recordIds: Set<string>;
        editableIds: Set<string>;
        recordAccess: Map<string, ResolvedObjectSchema>;
        peerIds: Set<string>;
      }
    >();
    for (const objectCode of new Set(
      targets.map((target) => target.objectCode),
    )) {
      if (typeof objectCode !== 'string') continue;
      let resolved: ResolvedObjectSchema;
      try {
        resolved = await resolvePublishedObjectInTransaction(
          tx,
          context,
          objectCode,
        );
      } catch (error) {
        // Revoked/unpublished objects redact history, but infrastructure failures
        // must not be mistaken for an authorization decision.
        if (
          error instanceof ApiException &&
          [403, 404].includes(error.getStatus())
        )
          continue;
        throw error;
      }
      if (!isReadable(resolved.schema, resolved.access)) continue;
      const ids = targets
        .filter((target) => target.objectCode === objectCode)
        .map((target) => target.recordId)
        .filter((id): id is string => typeof id === 'string');
      const recordAccess = new Map<string, ResolvedObjectSchema>();
      const peerIds = new Set<string>();
      let recordIds: string[];
      if (resolved.access.groupFieldAccess) {
        const ownerFilter = recordOwnerFilter(
          resolved.access,
          context.memberId,
        );
        const records = await tx.record.findMany({
          where: {
            tenantId: context.tenantId,
            objectId: resolved.schema.object.id,
            id: { in: ids },
            ownerMemberId: ownerFilter,
            deletedAt: null,
          },
          select: { id: true, ownerMemberId: true, inPublicPool: true },
        });
        recordIds = [];
        for (const record of records) {
          if (!recordOwnerMatches(ownerFilter, record.ownerMemberId)) continue;
          recordIds.push(record.id);
          if (isGroupPeer(resolved.access, record)) peerIds.add(record.id);
          recordAccess.set(record.id, {
            ...resolved,
            access: {
              ...resolved.access,
              fields: recordFieldAccess(resolved.access, record),
            },
          });
        }
      } else {
        recordIds = await visibleRecordIdsInTransaction(
          tx,
          context,
          resolved.schema.object.id,
          ids,
          recordOwnerFilter(resolved.access, context.memberId),
        );
      }
      const editableIds =
        !resolved.access.canUpdate || resolved.access.updateScope === 'NONE'
          ? []
          : resolved.access.updateScope === 'OWN' &&
              resolved.access.readScope !== 'OWN'
            ? await visibleRecordIdsInTransaction(
                tx,
                context,
                resolved.schema.object.id,
                recordIds,
                context.memberId,
              )
            : recordIds;
      visibility.set(objectCode, {
        peerIds,
        recordAccess,
        resolved,
        recordIds: new Set(recordIds),
        editableIds: new Set(editableIds),
      });
    }
    const followUpIds = rows.flatMap((row) => {
      if (row.operationType !== 'CREATE_FOLLOW_UP' || row.status !== 'EXECUTED')
        return [];
      const result = row.resultJson;
      if (!result || typeof result !== 'object' || Array.isArray(result))
        return [];
      const followUpId = (result as { followUpId?: unknown }).followUpId;
      return typeof followUpId === 'string' ? [followUpId] : [];
    });
    const accessibleFollowUps = new Set(
      followUpIds.length
        ? await this.followUps.visibleFollowUpIdsInTransaction(
            tx,
            context,
            followUpIds,
          )
        : [],
    );
    return rows.map((row, index) => {
      const target = targets[index];
      const visible = target.objectCode
        ? visibility.get(target.objectCode)
        : undefined;
      return toView(
        row,
        (target.recordId
          ? visible?.recordAccess.get(target.recordId)
          : undefined) ??
          visible?.resolved ??
          null,
        !!visible &&
          typeof target.recordId === 'string' &&
          visible.recordIds.has(target.recordId),
        !!visible &&
          typeof target.recordId === 'string' &&
          (visible.editableIds.has(target.recordId) ||
            (row.operationType === 'UPDATE_RECORD' &&
              visible.resolved.access.canUpdate &&
              visible.peerIds.has(target.recordId))),
        row.operationType !== 'CREATE_FOLLOW_UP' ||
          row.status !== 'EXECUTED' ||
          (!!row.resultJson &&
            typeof row.resultJson === 'object' &&
            !Array.isArray(row.resultJson) &&
            typeof (row.resultJson as { followUpId?: unknown }).followUpId ===
              'string' &&
            accessibleFollowUps.has(
              (row.resultJson as { followUpId: string }).followUpId,
            )),
      );
    });
  }

  createValidated(
    context: TenantContext,
    turnId: string,
    candidate: ValidatedAiOperation,
    display: StoredAiProposalDisplay,
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
    display: StoredAiProposalDisplay,
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
        itemKey: candidate.itemKey ?? 1,
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
    return await this.projectInTransaction(tx, context, row);
  }

  getOwned(context: TenantContext, id: string): Promise<AiProposalView | null> {
    return this.runner.withTenant(context, async (tx) => {
      const row = await tx.aiOperation.findFirst({
        where: { id, ...ownedWhere(context) },
      });
      return row ? await this.projectInTransaction(tx, context, row) : null;
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
  ): Promise<HistoryItem[]> {
    if (turnIds.length === 0) return [];
    const rows = await tx.aiOperation.findMany({
      where: {
        ...ownedWhere(context),
        conversationId,
        turnId: { in: turnIds },
      },
      orderBy: { itemKey: 'asc' },
    });
    const views = await this.projectRowsInTransaction(
      tx,
      context,
      rows.map((row) =>
        row.expiresAt.getTime() <= Date.now() && row.status === 'PROPOSED'
          ? { ...row, status: 'EXPIRED' }
          : row,
      ),
    );
    return rows.map((row, index) => ({
      turnId: row.turnId!,
      view: views[index],
      coverage: (row.displayChangesJson as unknown as StoredAiProposalDisplay)
        .coverage,
    }));
  }

  countOwnedBatchItems(context: TenantContext, turnId: string, ids: string[]) {
    return this.runner.withTenant(context, (tx) =>
      tx.aiOperation.count({
        where: { ...ownedWhere(context), turnId, id: { in: ids } },
      }),
    );
  }

  findFailedInConversation(
    tx: Tx,
    context: TenantContext,
    conversationId: string,
    id: string,
  ) {
    return tx.aiOperation.findFirst({
      where: {
        ...ownedWhere(context),
        conversationId,
        id,
        status: { in: ['FAILED', 'CONFLICTED'] },
      },
    });
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
    if (row.status === 'EXECUTED') {
      const view = await this.projectInTransaction(tx, context, row);
      return { kind: 'EXECUTED', result: view.result, view };
    }
    if (row.status !== 'PROPOSED')
      return {
        kind: 'TERMINAL',
        view: await this.projectInTransaction(tx, context, row),
      };
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
      return {
        kind: 'EXPIRED',
        view: await this.projectInTransaction(tx, context, {
          ...row,
          status: 'EXPIRED',
        }),
      };
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
        OR: [
          {
            conversation: {
              deletedAt: null,
              createdByMemberId: context.memberId,
            },
          },
          { draft: { memberId: context.memberId, tenantId: context.tenantId } },
        ],
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
    fieldErrors?: Record<string, AiFieldFailureCode>,
    appendFailureAudit?: (tx: Tx) => Promise<string>,
  ): Promise<AiProposalView | null> {
    return this.runner.withTenant(context, async (tx) => {
      const current = fieldErrors
        ? await tx.aiOperation.findFirst({
            where: { id, status: 'PROPOSED', ...ownedWhere(context) },
            select: { displayChangesJson: true },
          })
        : null;
      const safeCodes: Record<string, AiFieldFailureCode> = {};
      if (
        fieldErrors &&
        typeof fieldErrors === 'object' &&
        !Array.isArray(fieldErrors)
      ) {
        for (const [key, value] of Object.entries(fieldErrors)) {
          if (
            key.length > 120 ||
            Object.keys(safeCodes).length >= 50 ||
            ['__proto__', 'constructor', 'prototype'].includes(key)
          )
            continue;
          if (
            value === 'FIELD_REQUIRED' ||
            value === 'FIELD_INVALID' ||
            value === 'FIELD_OPTION_INACTIVE'
          )
            safeCodes[key] = value;
        }
      }
      const display = current?.displayChangesJson;
      const changed = await tx.aiOperation.updateMany({
        where: {
          id,
          status: 'PROPOSED',
          ...ownedWhere(context),
        },
        data: {
          status: state,
          failureCode: code,
          ...(display &&
          typeof display === 'object' &&
          !Array.isArray(display) &&
          Object.keys(safeCodes).length
            ? {
                displayChangesJson: {
                  ...display,
                  failureFieldCodes: safeCodes,
                },
              }
            : {}),
          confirmedByMemberId: context.memberId,
          confirmedAt: new Date(),
        },
      });
      if (changed.count === 1 && appendFailureAudit) {
        const auditId = await appendFailureAudit(tx);
        await tx.aiOperation.update({ where: { id }, data: { auditId } });
      }
      // A competing confirm/reject may have committed first: return its actual
      // terminal status rather than pretending our conditional update won.
      const row = await tx.aiOperation.findFirst({
        where: { id, ...ownedWhere(context) },
      });
      return row ? await this.projectInTransaction(tx, context, row) : null;
    });
  }
}
