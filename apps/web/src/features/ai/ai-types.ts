import type {
  AiPublicStreamEvent,
  AiSourceSummary,
  AiToolSummary,
} from "@crm/contracts";

export type {
  AiPublicStreamEvent,
  AiSourceSummary,
  AiToolSummary,
};

export type AiTurnPhase =
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
  errorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface AiMessagePage {
  items: AiMessage[];
  nextBefore?: string;
}

export interface AiStreamTurnInput {
  conversationId?: string;
  content: string;
}

export const AI_MAX_INPUT = 2000;
