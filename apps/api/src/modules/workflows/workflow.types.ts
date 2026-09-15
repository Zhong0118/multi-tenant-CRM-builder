export const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const WORKFLOW_ROLES = ['TENANT_ADMIN', 'EMPLOYEE'] as const;

export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

export interface WorkflowStateDraft {
  key: string;
  label: string;
  description?: string | null;
  sortOrder: number;
  isTerminal: boolean;
}

export interface WorkflowTransitionDraft {
  key: string;
  label: string;
  fromStateKey: string;
  toStateKey: string;
  allowedRoles: WorkflowRole[];
  requiredFieldKeys: string[];
  sortOrder: number;
}

export interface WorkflowDraft {
  isEnabled: boolean;
  initialStateKey: string | null;
  states: WorkflowStateDraft[];
  transitions: WorkflowTransitionDraft[];
}

export interface WorkflowDraftResponse extends WorkflowDraft {
  objectVersion: number;
}

export interface PublishedWorkflowState {
  key: string;
  label: string;
  sortOrder: number;
  isTerminal: boolean;
}

export interface PublishedWorkflowTransition {
  key: string;
  label: string;
  fromStateKey: string;
  toStateKey: string;
  allowedRoles: WorkflowRole[];
  requiredFieldKeys: string[];
}

export interface PublishedWorkflow {
  initialStateKey: string;
  states: PublishedWorkflowState[];
  transitions: PublishedWorkflowTransition[];
}
