import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { PublishedObjectService } from '../objects/published-object.service';
import { RECORDS_REPOSITORY } from '../records/records.service';
import type {
  DynamicRecord,
  RecordsRepository,
} from '../records/records.repository';
import {
  resolveExecutableTransition,
  runtimeWorkflowView,
  START_TRANSITION_KEY,
  type RuntimeWorkflowView,
} from './workflow-runtime';

interface RequestMeta {
  requestId: string;
  ip?: string;
}

export interface WorkflowHistoryItem {
  id: string;
  transitionKey: string;
  transitionLabel: string;
  fromStateKey: string | null;
  fromStateLabel: string | null;
  toStateKey: string;
  toStateLabel: string;
  actorMemberId: string;
  actorDisplayName: string | null;
  createdAt: string;
}

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly publishedObjects: PublishedObjectService,
    @Inject(RECORDS_REPOSITORY)
    private readonly records: RecordsRepository,
  ) {}

  async get(
    context: TenantContext,
    objectCode: string,
    recordId: string,
  ): Promise<RuntimeWorkflowView> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.records.withTenant(context, async (store) => {
      const record = await requireReadableRecord(
        store,
        resolved.schema.object.id,
        recordId,
        context,
        resolved.access.readScope,
        resolved.access.canRead,
      );
      return runtimeWorkflowView({
        schema: resolved.schema,
        access: resolved.access,
        role: context.role,
        record,
      });
    });
  }

  async execute(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    transitionKey: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<RuntimeWorkflowView> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.records.withTenant(context, async (store) => {
      const current = await requireReadableRecord(
        store,
        resolved.schema.object.id,
        recordId,
        context,
        resolved.access.updateScope,
        resolved.access.canUpdate,
        'UPDATE',
      );
      if (current.version !== input.expectedVersion) {
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      }
      const transition = resolveExecutableTransition({
        schema: resolved.schema,
        access: resolved.access,
        role: context.role,
        record: current,
        transitionKey,
      });
      const updated = await store.applyWorkflowTransition({
        recordId,
        expectedVersion: input.expectedVersion,
        workflowStateKey: transition.toStateKey,
        history: {
          objectDefinitionId: resolved.schema.object.id,
          objectPublicationId: resolved.schema.publication.id,
          transitionKey: transition.key,
          transitionLabel: transition.label,
          fromStateKey: transition.fromStateKey,
          fromStateLabel: transition.fromStateLabel,
          toStateKey: transition.toStateKey,
          toStateLabel: transition.toStateLabel,
          actorMemberId: context.memberId,
        },
      });
      if (!updated) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action:
          transition.key === START_TRANSITION_KEY
            ? 'record.workflow_started'
            : 'record.transition_executed',
        resourceType: 'record',
        resourceId: recordId,
        after: {
          objectCode,
          transitionKey: transition.key,
          fromStateKey: transition.fromStateKey,
          toStateKey: transition.toStateKey,
          recordVersionBefore: current.version,
          recordVersionAfter: updated.version,
        },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return runtimeWorkflowView({
        schema: resolved.schema,
        access: resolved.access,
        role: context.role,
        record: updated,
      });
    });
  }

  async history(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{
    items: WorkflowHistoryItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.records.withTenant(context, async (store) => {
      await requireReadableRecord(
        store,
        resolved.schema.object.id,
        recordId,
        context,
        resolved.access.readScope,
        resolved.access.canRead,
      );
      return store.listTransitionHistory(recordId, query);
    });
  }
}

async function requireReadableRecord(
  store: {
    findRecord(
      objectId: string,
      recordId: string,
    ): Promise<DynamicRecord | null>;
  },
  objectId: string,
  recordId: string,
  context: TenantContext,
  scope: 'ALL' | 'OWN' | 'NONE',
  allowed: boolean,
  action: 'READ' | 'UPDATE' = 'READ',
): Promise<DynamicRecord> {
  if (!allowed || scope === 'NONE') {
    throw new ApiException(
      action === 'UPDATE'
        ? 'WORKFLOW_TRANSITION_FORBIDDEN'
        : 'OBJECT_ACTION_FORBIDDEN',
      403,
    );
  }
  const record = await store.findRecord(objectId, recordId);
  if (!record || (scope === 'OWN' && record.ownerMemberId !== context.memberId)) {
    throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  return record;
}
