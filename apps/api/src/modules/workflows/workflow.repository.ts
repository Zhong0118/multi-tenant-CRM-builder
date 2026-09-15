import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import type { AuditEvent } from '../audit/audit-event';
import {
  toWorkflowActions,
  type WorkflowDraft,
  type WorkflowDraftResponse,
} from './workflow.types';

export interface WorkflowStore {
  findObjectVersion(
    objectId: string,
  ): Promise<{ id: string; version: number; fieldKeys: string[] } | null>;
  findDraft(objectId: string): Promise<WorkflowDraft | null>;
  replaceDraft(input: {
    objectId: string;
    expectedVersion: number;
    draft: WorkflowDraft;
    actorMemberId: string;
  }): Promise<WorkflowDraftResponse | null>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface WorkflowRepository {
  withTenant<T>(
    context: TenantContext,
    work: (store: WorkflowStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrismaWorkflowRepository implements WorkflowRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  withTenant<T>(
    context: TenantContext,
    work: (store: WorkflowStore) => Promise<T>,
  ): Promise<T> {
    return this.runner.withTenant(context, (transaction) =>
      work(new PrismaWorkflowStore(transaction, this.audit, context)),
    );
  }
}

class PrismaWorkflowStore implements WorkflowStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
    private readonly context: TenantContext,
  ) {}

  async findObjectVersion(objectId: string) {
    const object = await this.transaction.objectDefinition.findFirst({
      where: { id: objectId, tenantId: this.context.tenantId },
      select: {
        id: true,
        version: true,
        fields: { select: { fieldKey: true, status: true } },
      },
    });
    if (!object) return null;
    return {
      id: object.id,
      version: object.version,
      fieldKeys: object.fields
        .filter((field) => field.status === 'ACTIVE')
        .map((field) => field.fieldKey),
    };
  }

  async findDraft(objectId: string): Promise<WorkflowDraft | null> {
    const workflow = await this.transaction.objectWorkflowDefinition.findFirst({
      where: {
        tenantId: this.context.tenantId,
        objectDefinitionId: objectId,
      },
      include: {
        states: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
        transitions: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
      },
    });
    if (!workflow) return null;
    return {
      isEnabled: workflow.isEnabled,
      initialStateKey: workflow.initialStateKey,
      states: workflow.states.map((state) => ({
        key: state.key,
        label: state.label,
        description: state.description,
        sortOrder: state.sortOrder,
        isTerminal: state.isTerminal,
      })),
      transitions: workflow.transitions.map((transition) => ({
        key: transition.key,
        label: transition.label,
        fromStateKey: transition.fromStateKey,
        toStateKey: transition.toStateKey,
        allowedRoles: transition.allowedRoles as WorkflowDraft['transitions'][number]['allowedRoles'],
        requiredFieldKeys: transition.requiredFieldKeys,
        actions: toWorkflowActions(transition.actions),
        sortOrder: transition.sortOrder,
      })),
    };
  }

  async replaceDraft(input: {
    objectId: string;
    expectedVersion: number;
    draft: WorkflowDraft;
    actorMemberId: string;
  }): Promise<WorkflowDraftResponse | null> {
    const locked = await this.transaction.$queryRaw<Array<{ version: number }>>`
      SELECT version
      FROM object_definitions
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND id = ${input.objectId}::uuid
      FOR UPDATE
    `;
    if (locked[0]?.version !== input.expectedVersion) return null;

    const existing = await this.transaction.objectWorkflowDefinition.findFirst({
      where: {
        tenantId: this.context.tenantId,
        objectDefinitionId: input.objectId,
      },
      select: { id: true },
    });
    if (existing) {
      await this.transaction.workflowTransitionDefinition.deleteMany({
        where: { tenantId: this.context.tenantId, workflowDefinitionId: existing.id },
      });
      await this.transaction.workflowStateDefinition.deleteMany({
        where: { tenantId: this.context.tenantId, workflowDefinitionId: existing.id },
      });
      await this.transaction.objectWorkflowDefinition.delete({
        where: { id: existing.id },
      });
    }

    await this.transaction.objectWorkflowDefinition.create({
      data: {
        tenantId: this.context.tenantId,
        objectDefinitionId: input.objectId,
        isEnabled: input.draft.isEnabled,
        initialStateKey: input.draft.initialStateKey,
        createdByMemberId: input.actorMemberId,
        updatedByMemberId: input.actorMemberId,
        states: {
          create: input.draft.states.map((state) => ({
            key: state.key,
            label: state.label,
            description: state.description ?? null,
            sortOrder: state.sortOrder,
            isTerminal: state.isTerminal,
          })),
        },
        transitions: {
          create: input.draft.transitions.map((transition) => ({
            key: transition.key,
            label: transition.label,
            fromStateKey: transition.fromStateKey,
            toStateKey: transition.toStateKey,
            allowedRoles: transition.allowedRoles,
            requiredFieldKeys: transition.requiredFieldKeys,
            // The Action union is built from interfaces, which cannot satisfy
            // Prisma's `InputJsonValue` index signature without an assertion.
            // The steps are already validated by `validateTransitionActions()`.
            actions: toWorkflowActionsJson(transition.actions ?? []),
            sortOrder: transition.sortOrder,
          })),
        },
      },
    });

    await this.transaction.objectDefinition.update({
      where: { id: input.objectId },
      data: { version: { increment: 1 } },
    });

    return {
      ...input.draft,
      objectVersion: input.expectedVersion + 1,
    };
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function toWorkflowActionsJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
