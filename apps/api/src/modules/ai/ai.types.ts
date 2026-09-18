import type { TenantContext } from '../../common/tenancy/tenant-context';

export type { TenantContext };

export type AiMessageRole = 'USER' | 'ASSISTANT';
export type AiMessageStatus =
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ConversationListQuery {
  cursor?: string;
  limit?: number;
}

export interface ConversationMessageQuery {
  before?: string;
  limit?: number;
}

export interface BeginTurnInput {
  conversationId?: string;
  content: string;
}

export interface AssistantFinalizeOutcome {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  content: string;
  usage?: Record<string, unknown>;
  errorCode?: string | null;
}

export interface ConversationListItem {
  id: string;
  title: string;
  lastMessageAt: string;
  latestUserPreview: string | null;
}

export interface ConversationListPage {
  items: ConversationListItem[];
  nextCursor?: string;
}

export interface PublicAiMessage {
  id: string;
  conversationId: string;
  turnId: string;
  role: AiMessageRole;
  status: AiMessageStatus;
  content: string;
  toolSummary: unknown;
  sourceSummary: unknown;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ConversationMessagePage {
  items: PublicAiMessage[];
  nextBefore?: string;
}

export interface BeginTurnResult {
  conversationId: string;
  title: string;
  turnId: string;
  user: {
    id: string;
    status: AiMessageStatus;
    content: string;
    turnId: string;
    completedAt: Date | null;
  };
  assistant: {
    id: string;
    status: AiMessageStatus;
    content: string;
    turnId: string;
    toolSummary: unknown;
    sourceSummary: unknown;
    providerUsage: unknown;
    errorCode: string | null;
    completedAt: Date | null;
  };
}
