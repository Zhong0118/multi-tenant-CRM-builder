import { describe, expect, it } from "vitest";

import { aiTurnReducer, initialAiTurnState } from "./ai-turn-reducer";

describe("aiTurnReducer", () => {
  it("moves IDLE → SENDING → STREAMING → COMPLETED and records conversation.ready immediately", () => {
    let state = aiTurnReducer(initialAiTurnState, {
      type: "beginNewTurn",
      content: "问",
    });
    expect(state.phase).toBe("SENDING");
    state = aiTurnReducer(state, {
      type: "event",
      event: {
        event: "conversation.ready",
        data: { conversationId: "c1", title: "问", turnId: "t1" },
      },
    });
    expect(state.phase).toBe("STREAMING");
    expect(state.conversationId).toBe("c1");
    state = aiTurnReducer(state, {
      type: "event",
      event: { event: "turn.completed", data: { turnId: "t1", messageId: "m1" } },
    });
    expect(state.phase).toBe("COMPLETED");
  });

  it("cancels and fails from STREAMING, and marks partial completion after a tool failure", () => {
    const streaming = aiTurnReducer(
      aiTurnReducer(initialAiTurnState, {
        type: "beginNewTurn",
        content: "问",
      }),
      {
        type: "event",
        event: {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t1" },
        },
      },
    );
    expect(
      aiTurnReducer(streaming, { type: "cancel" }).phase,
    ).toBe("CANCELLED");
    expect(
      aiTurnReducer(streaming, {
        type: "event",
        event: {
          event: "turn.failed",
          data: { turnId: "t1", code: "AI_PROVIDER_TIMEOUT", messageId: "m1" },
        },
      }).errorMessage,
    ).toBe("AI 暂时没有响应，请重试");
    const partial = aiTurnReducer(streaming, {
      type: "event",
      event: {
        event: "tool.failed",
        data: {
          callId: "x",
          toolName: "list_followups",
          displayName: "查询跟进",
          status: "FAILED",
        },
      },
    });
    expect(
      aiTurnReducer(partial, {
        type: "event",
        event: { event: "turn.completed", data: { turnId: "t1", messageId: "m1" } },
      }).phase,
    ).toBe("PARTIAL_COMPLETED");
  });

  it("does not reset a live turn when hydrating the same conversation id", () => {
    const streaming = aiTurnReducer(
      aiTurnReducer(initialAiTurnState, {
        type: "beginNewTurn",
        content: "问",
      }),
      {
        type: "event",
        event: {
          event: "conversation.ready",
          data: { conversationId: "c1", title: "问", turnId: "t1" },
        },
      },
    );
    const same = aiTurnReducer(streaming, {
      type: "hydrate",
      conversationId: "c1",
    });
    expect(same.phase).toBe("STREAMING");
    expect(same.turnId).toBe("t1");
    expect(same.streamingText).toBe("");
  });

  it("clears the previous turnId on a new send and keeps it on retry", () => {
    const previous = {
      ...initialAiTurnState,
      conversationId: "c1",
      turnId: "old-turn",
      phase: "COMPLETED" as const,
    };
    const next = aiTurnReducer(previous, {
      type: "beginNewTurn",
      content: "下一问",
    });
    expect(next.turnId).toBeUndefined();
    expect(next.phase).toBe("SENDING");
    expect(next.pendingUserContent).toBe("下一问");
    const retry = aiTurnReducer(previous, {
      type: "beginRetryTurn",
      turnId: "old-turn",
    });
    expect(retry.turnId).toBe("old-turn");
    expect(retry.phase).toBe("SENDING");
  });
});
