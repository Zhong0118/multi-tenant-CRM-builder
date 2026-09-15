"use client";

import { relationRequest } from "@/lib/api/relation-request";

import type {
  RuntimeWorkflow,
  SaveWorkflowDraftInput,
  WorkflowDraft,
  WorkflowHistoryPage,
} from "./workflow-types";

export interface WorkflowApi {
  getDraft(tenantCode: string, objectId: string): Promise<WorkflowDraft>;
  saveDraft(
    tenantCode: string,
    objectId: string,
    input: SaveWorkflowDraftInput,
  ): Promise<WorkflowDraft>;
  getRuntime(
    tenantCode: string,
    objectCode: string,
    recordId: string,
  ): Promise<RuntimeWorkflow>;
  executeTransition(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    transitionKey: string,
    expectedVersion: number,
  ): Promise<RuntimeWorkflow>;
  history(
    tenantCode: string,
    objectCode: string,
    recordId: string,
  ): Promise<WorkflowHistoryPage>;
}

function draftPath(tenantCode: string, objectId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(tenantCode)}/object-definitions/${encodeURIComponent(objectId)}/workflow`;
}

function runtimePath(
  tenantCode: string,
  objectCode: string,
  recordId: string,
) {
  return `/api/v1/workspaces/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(objectCode)}/records/${encodeURIComponent(recordId)}/workflow`;
}

export const workflowApi: WorkflowApi = {
  getDraft(tenantCode, objectId) {
    return relationRequest<WorkflowDraft>(draftPath(tenantCode, objectId));
  },
  saveDraft(tenantCode, objectId, input) {
    return relationRequest<WorkflowDraft>(
      draftPath(tenantCode, objectId),
      "PUT",
      input,
    );
  },
  getRuntime(tenantCode, objectCode, recordId) {
    return relationRequest<RuntimeWorkflow>(
      runtimePath(tenantCode, objectCode, recordId),
    );
  },
  executeTransition(
    tenantCode,
    objectCode,
    recordId,
    transitionKey,
    expectedVersion,
  ) {
    return relationRequest<RuntimeWorkflow>(
      `${runtimePath(tenantCode, objectCode, recordId)}/transitions/${encodeURIComponent(transitionKey)}`,
      "POST",
      { expectedVersion },
    );
  },
  history(tenantCode, objectCode, recordId) {
    return relationRequest<WorkflowHistoryPage>(
      `${runtimePath(tenantCode, objectCode, recordId)}/history`,
    );
  },
};
