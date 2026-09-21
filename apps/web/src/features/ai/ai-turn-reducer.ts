import type {
  AiMessage,
  AiPublicStreamEvent,
  AiSourceSummary,
  AiToolSummary,
  AiTurnPhase,
} from "./ai-types";

export interface AiTurnState {
  phase: AiTurnPhase;
  conversationId?: string;
  turnId?: string;
  title?: string;
  draft: string;
  streamingText: string;
  tools: AiToolSummary[];
  sources: AiSourceSummary[];
  errorCode?: string | null;
  errorMessage?: string;
  partial: boolean;
  pendingUserContent?: string;
}

export const initialAiTurnState: AiTurnState = {
  phase: "IDLE",
  draft: "",
  streamingText: "",
  tools: [],
  sources: [],
  partial: false,
};

export type AiTurnAction =
  | { type: "draft"; value: string }
  | { type: "beginNewTurn"; content: string }
  | { type: "beginRetryTurn"; turnId: string }
  | { type: "event"; event: AiPublicStreamEvent }
  | { type: "cancel" }
  | { type: "network" }
  | { type: "reset" }
  | { type: "hydrate"; conversationId: string };

export function aiTurnReducer(
  state: AiTurnState,
  action: AiTurnAction,
): AiTurnState {
  switch (action.type) {
    case "draft":
      return { ...state, draft: action.value.slice(0, 2000) };
    case "hydrate":
      if (state.conversationId === action.conversationId) return state;
      return {
        ...initialAiTurnState,
        conversationId: action.conversationId,
      };
    case "reset":
      return { ...initialAiTurnState, conversationId: undefined };
    case "beginNewTurn":
      return {
        ...state,
        phase: "SENDING",
        turnId: undefined,
        streamingText: "",
        tools: [],
        sources: [],
        errorCode: null,
        errorMessage: undefined,
        partial: false,
        draft: "",
        pendingUserContent: action.content,
      };
    case "beginRetryTurn":
      return {
        ...state,
        phase: "SENDING",
        turnId: action.turnId,
        streamingText: "",
        tools: [],
        sources: [],
        errorCode: null,
        errorMessage: undefined,
        partial: false,
        pendingUserContent: undefined,
      };
    case "cancel":
      if (state.phase !== "SENDING" && state.phase !== "STREAMING") {
        return state;
      }
      return {
        ...state,
        phase: "CANCELLED",
        errorMessage: "回答已停止",
      };
    case "network":
      if (state.phase !== "SENDING" && state.phase !== "STREAMING") {
        return state;
      }
      return {
        ...state,
        phase: "FAILED",
        errorCode: "NETWORK",
        errorMessage: "连接已中断",
      };
    case "event":
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

function applyEvent(
  state: AiTurnState,
  event: AiPublicStreamEvent,
): AiTurnState {
  switch (event.event) {
    case "conversation.ready":
      return {
        ...state,
        phase: "STREAMING",
        conversationId: event.data.conversationId,
        turnId: event.data.turnId,
        title: event.data.title,
      };
    case "turn.started":
      return { ...state, phase: "STREAMING", turnId: event.data.turnId };
    case "assistant.delta":
      return {
        ...state,
        phase: "STREAMING",
        streamingText: state.streamingText + event.data.text,
      };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return {
        ...state,
        tools: upsertTool(state.tools, event.data),
        partial: event.event === "tool.failed" ? true : state.partial,
      };
    case "sources.updated":
      return { ...state, sources: event.data.sources };
    case "turn.completed":
      return {
        ...state,
        phase: state.partial ? "PARTIAL_COMPLETED" : "COMPLETED",
        pendingUserContent: undefined,
        errorMessage: state.partial
          ? "部分 CRM 数据暂时无法读取，本次回答可能不完整"
          : undefined,
      };
    case "turn.failed":
      return {
        ...state,
        phase: "FAILED",
        turnId: event.data.turnId,
        errorCode: event.data.code,
        errorMessage: userErrorMessage(event.data.code),
      };
    case "turn.cancelled":
      return {
        ...state,
        phase: "CANCELLED",
        errorMessage: "回答已停止",
      };
    default:
      return state;
  }
}

function upsertTool(
  tools: AiToolSummary[],
  summary: AiToolSummary,
): AiToolSummary[] {
  const index = tools.findIndex((item) => item.callId === summary.callId);
  if (index < 0) return [...tools, summary];
  const next = [...tools];
  next[index] = summary;
  return next;
}

export function userErrorMessage(code?: string | null): string {
  switch (code) {
    case "AI_PROVIDER_TIMEOUT":
      return "AI 暂时没有响应，请重试";
    case "AI_PROVIDER_UNAVAILABLE":
      return "AI 服务暂时不可用，请稍后重试";
    case "WORKSPACE_FORBIDDEN":
    case "AI_CONVERSATION_NOT_FOUND":
      return "你的访问权限发生变化，请重新提问";
    case "NETWORK":
      return "连接已中断";
    case "AI_STREAM_INVALID":
      return "连接已中断";
    default:
      return "AI 服务暂时不可用，请稍后重试";
  }
}

export function toAssistantMessage(state: AiTurnState): AiMessage | null {
  if (!state.conversationId || !state.turnId) return null;
  if (
    state.phase !== "COMPLETED" &&
    state.phase !== "PARTIAL_COMPLETED" &&
    state.phase !== "FAILED" &&
    state.phase !== "CANCELLED" &&
    state.phase !== "STREAMING"
  ) {
    return null;
  }
  return {
    id: `stream-${state.turnId}`,
    conversationId: state.conversationId,
    turnId: state.turnId,
    role: "ASSISTANT",
    status: state.phase,
    content: state.streamingText,
    toolSummary: state.tools,
    sourceSummary: state.sources,
    errorCode: state.errorCode,
    createdAt: new Date().toISOString(),
  };
}
