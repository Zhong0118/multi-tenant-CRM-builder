export const WORKFLOW_ROLES = ["TENANT_ADMIN", "EMPLOYEE"] as const;
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
  objectVersion: number;
}

export interface SaveWorkflowDraftInput {
  expectedDraftRevision: number;
  isEnabled: boolean;
  initialStateKey: string | null;
  states: WorkflowStateDraft[];
  transitions: WorkflowTransitionDraft[];
}

export interface RuntimeWorkflowState {
  key: string;
  label: string;
  isTerminal: boolean;
}

export interface RuntimeAvailableTransition {
  key: string;
  label: string;
  toState?: { key: string; label: string };
  requiredFieldKeys: string[];
}

export interface RuntimeWorkflow {
  currentState: RuntimeWorkflowState | null;
  availableTransitions: RuntimeAvailableTransition[];
  recordVersion: number;
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

export interface WorkflowHistoryPage {
  items: WorkflowHistoryItem[];
  page: number;
  limit: number;
  total: number;
}
