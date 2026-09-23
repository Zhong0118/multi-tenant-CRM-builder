import type { Prisma } from '@crm/database';

export type AiOperationRow = Prisma.AiOperationGetPayload<Record<string, never>>;
export type AiOperationKind = 'UPDATE_RECORD' | 'CREATE_FOLLOW_UP' | 'ADD_ACTIVITY_NOTE';
export type AiOperationState = 'PROPOSED' | 'REJECTED' | 'EXPIRED' | 'CONFLICTED' | 'FAILED' | 'EXECUTED';

// Only the server's strict proposal validator may construct this input. It
// contains no actor selectors; the repository derives ownership from context.
export interface ValidatedAiOperation {
  conversationId: string;
  operationType: AiOperationKind;
  requestText: string;
  proposal: Prisma.InputJsonObject;
  targetRef: Prisma.InputJsonObject;
  expectedVersion: number;
  expectedPublicationId: string;
}

export interface AiProposalDisplay {
  title: string;
  targetSummary: string;
  changes: Array<{ label: string; before?: string; after?: string }>;
  validationWarnings: string[];
}

export interface AiProposalView extends AiProposalDisplay {
  proposalId: string;
  operation: AiOperationKind;
  status: AiOperationState;
  expiresAt: string;
  failureCode: string | null;
  result: Prisma.JsonValue | null;
  auditId: string | null;
}

export type LockedAiOperation =
  | { kind: 'NOT_FOUND' }
  | { kind: 'EXPIRED'; view: AiProposalView }
  | { kind: 'EXECUTED'; result: Prisma.JsonValue | null; view: AiProposalView }
  | { kind: 'TERMINAL'; view: AiProposalView }
  | { kind: 'PROPOSED'; operation: AiOperationRow };
