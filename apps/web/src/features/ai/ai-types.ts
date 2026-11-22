import type {
  AssistantQuestion,
  AssistantAction,
  AssistantBatch,
  AssistantPageHint,
  AssistantAnswerValue,
  FilterRule,
} from "@crm/contracts";
import type {
  AiPublicStreamEvent,
  AiProposalView,
  AiSourceSummary,
  AiToolSummary,
} from "@crm/contracts";

export type {
  AiPublicStreamEvent,
  AiProposalView,
  AiSourceSummary,
  AiToolSummary,
};

export type AiTurnPhase =
  | "WAITING"
  | "IDLE"
  | "SENDING"
  | "STREAMING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"
  | "PARTIAL_COMPLETED";

export interface AiConversation {
  id: string;
  title: string;
  lastMessageAt: string;
  latestUserPreview?: string | null;
}

export interface AiConversationPage {
  items: AiConversation[];
  nextCursor?: string;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  turnId: string;
  role: string;
  status: string;
  content: string;
  toolSummary: AiToolSummary[];
  sourceSummary: AiSourceSummary[];
  proposal?: AiProposalView | null;
  questions?: AssistantQuestion[];
  batch?: AssistantBatch | null;
  action?: AssistantAction | null;
  errorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
  durationMs?: number;
}

export interface AiMessagePage {
  items: AiMessage[];
  nextBefore?: string;
}

export type AiStreamTurnInput =
  | {
      conversationId?: string;
      content: string;
      context?: AssistantPageHint;
      filterDraft?: FilterRule;
    }
  | {
      conversationId: string;
      answer: { questionId: string; value: AssistantAnswerValue };
      context?: AssistantPageHint;
    }
  | {
      conversationId: string;
      regenerateProposalId: string;
      context?: AssistantPageHint;
    };
