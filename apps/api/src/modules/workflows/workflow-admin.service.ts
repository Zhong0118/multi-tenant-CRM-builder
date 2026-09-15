import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { validateWorkflowDraft } from './workflow-draft.policy';
import type { WorkflowRepository, WorkflowStore } from './workflow.repository';
import type {
  WorkflowDraft,
  WorkflowDraftInput,
  WorkflowDraftResponse,
} from './workflow.types';

export const WORKFLOW_REPOSITORY = Symbol('WORKFLOW_REPOSITORY');

interface RequestMeta {
  requestId: string;
  ip?: string;
}

const EMPTY_DRAFT: WorkflowDraft = {
  isEnabled: false,
  initialStateKey: null,
  states: [],
  transitions: [],
};

@Injectable()
export class WorkflowAdminService {
  constructor(
    @Inject(WORKFLOW_REPOSITORY)
    private readonly repository: WorkflowRepository,
  ) {}

  async get(
    context: TenantContext,
    objectId: string,
  ): Promise<WorkflowDraftResponse> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const object = await requireObject(store, objectId);
      const draft = (await store.findDraft(objectId)) ?? EMPTY_DRAFT;
      return { ...draft, objectVersion: object.version };
    });
  }

  async save(
    context: TenantContext,
    objectId: string,
    input: WorkflowDraftInput & { expectedDraftRevision: number },
    meta: RequestMeta,
  ): Promise<WorkflowDraftResponse> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const object = await requireObject(store, objectId);
      if (object.version !== input.expectedDraftRevision) {
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      }
      const draft = validateWorkflowDraft(
        {
          isEnabled: input.isEnabled,
          initialStateKey: input.initialStateKey,
          states: input.states,
          transitions: input.transitions,
        },
        { knownFieldKeys: object.fieldKeys },
      );
      const saved = await store.replaceDraft({
        objectId,
        expectedVersion: input.expectedDraftRevision,
        draft,
        actorMemberId: context.memberId,
      });
      if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'workflow.draft_updated',
        resourceType: 'object_definition',
        resourceId: objectId,
        after: {
          isEnabled: draft.isEnabled,
          initialStateKey: draft.initialStateKey,
          objectVersion: saved.objectVersion,
        },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return saved;
    });
  }
}

function assertTenantAdmin(context: TenantContext): void {
  if (context.role !== 'TENANT_ADMIN') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
}

async function requireObject(store: WorkflowStore, objectId: string) {
  const object = await store.findObjectVersion(objectId);
  if (!object) throw new ApiException('OBJECT_NOT_FOUND', 404);
  return object;
}
