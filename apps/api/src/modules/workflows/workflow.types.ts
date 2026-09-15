import type { WorkflowActionDraft } from '../actions/action.types';

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
  /**
   * Ordered Action steps of this Transition (§28). Absent means "no actions":
   * legacy drafts and publications without an `actions` column parse as `[]`.
   */
  actions?: WorkflowActionDraft[];
}

export interface WorkflowDraft {
  isEnabled: boolean;
  initialStateKey: string | null;
  states: WorkflowStateDraft[];
  transitions: WorkflowTransitionDraft[];
}

/**
 * Narrows the raw `JsonValue` a Draft read gets from the `actions` JSONB column.
 *
 * Action steps are validated before persistence, so this only re-types the
 * column value and normalizes a missing/legacy value to `[]`. Array order is
 * execution order (§28) and is handed back exactly as stored.
 */
export function toWorkflowActions(value: unknown): WorkflowActionDraft[] {
  return Array.isArray(value) ? (value as WorkflowActionDraft[]) : [];
}

/**
 * Untrusted transition input (HTTP DTO or persisted legacy data). `actions` are
 * deliberately untyped here; `validateTransitionActions()` owns their shape.
 */
export interface WorkflowTransitionDraftInput extends Omit<
  WorkflowTransitionDraft,
  'actions'
> {
  actions?: readonly unknown[];
}

export interface WorkflowDraftInput extends Omit<WorkflowDraft, 'transitions'> {
  transitions: WorkflowTransitionDraftInput[];
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
