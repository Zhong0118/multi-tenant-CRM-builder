export type AiToolStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface AiToolSummary {
  callId: string;
  toolName: string;
  displayName: string;
  status: AiToolStatus;
  detail?: string;
}

export type AiSourceSummary =
  | {
      kind: "RECORDS";
      objectCode: string;
      objectName: string;
      count: number;
    }
  | {
      kind: "AGGREGATE";
      objectCode: string;
      objectName: string;
      label: string;
      value: string;
    }
  | {
      kind: "TIMELINE";
      objectCode: string;
      objectName: string;
      recordId?: string;
      recordTitle?: string;
      count: number;
    };

export type AiPublicStreamEvent =
  | {
      event: "conversation.ready";
      data: { conversationId: string; title: string; turnId: string };
    }
  | { event: "turn.started"; data: { turnId: string } }
  | { event: "tool.started"; data: AiToolSummary }
  | { event: "tool.completed"; data: AiToolSummary }
  | { event: "tool.failed"; data: AiToolSummary }
  | { event: "assistant.delta"; data: { text: string } }
  | { event: "sources.updated"; data: { sources: AiSourceSummary[] } }
  | {
      event: "turn.completed";
      data: { turnId: string; messageId: string };
    }
  | {
      event: "turn.failed";
      data: { turnId: string; code: string; messageId: string };
    }
  | {
      event: "turn.cancelled";
      data: { turnId: string; messageId: string };
    };
