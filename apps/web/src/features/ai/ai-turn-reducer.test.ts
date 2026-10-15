import { describe, expect, it } from "vitest";

import {
  aiTurnReducer,
  initialAiTurnState,
  toAssistantMessage,
  type AiTurnState,
} from "./ai-turn-reducer";

describe("aiTurnReducer", () => {
  it("clears the previous proposal before a new or retried turn receives proposal.ready", () => {
    const withProposal = {
      ...initialAiTurnState,
      proposal: { proposalId: "old" } as AiTurnState["proposal"],
    };
    expect(
      aiTurnReducer(withProposal, { type: "beginNewTurn", content: "new" })
        .proposal,
    ).toBeNull();
    expect(
      aiTurnReducer(withProposal, { type: "beginRetryTurn", turnId: "retry" })
        .proposal,
    ).toBeNull();
  });
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
      event: {
        event: "turn.completed",
        data: { turnId: "t1", messageId: "m1" },
      },
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
    expect(aiTurnReducer(streaming, { type: "cancel" }).phase).toBe(
      "CANCELLED",
    );
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
        event: {
          event: "turn.completed",
          data: { turnId: "t1", messageId: "m1" },
        },
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

  it("keeps a real turnId on transport failure and does not invent unknown", () => {
    const ready = aiTurnReducer(
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
    const afterReady = aiTurnReducer(ready, {
      type: "transportFailure",
      code: "NETWORK",
    });
    expect(afterReady.turnId).toBe("t1");
    expect(afterReady.phase).toBe("FAILED");
    const beforeReady = aiTurnReducer(
      aiTurnReducer(initialAiTurnState, {
        type: "beginNewTurn",
        content: "问",
      }),
      { type: "transportFailure", code: "NETWORK" },
    );
    expect(beforeReady.turnId).toBeUndefined();
    expect(beforeReady.phase).toBe("FAILED");
  });
});

it("replaces earlier narration on answer-step reset without losing tool activity", () => {
  const state = { ...initialAiTurnState, phase: "STREAMING" as const, streamingText: "Let me query", tools: [{ callId: "c", toolName: "search_records", displayName: "查询", status: "COMPLETED" as const }] };
  const cleared = aiTurnReducer(state, { type: "event", event: { event: "assistant.reset", data: {} } });
  expect(cleared.streamingText).toBe("");
  expect(cleared.tools).toEqual(state.tools);
  expect(aiTurnReducer(cleared, { type: "event", event: { event: "assistant.delta", data: { text: "总额 255000 元" } } }).streamingText).toBe("总额 255000 元");
});

it("keeps attempt start stable, prefers server timing and resets timing on retry", () => {
  const begun = aiTurnReducer(initialAiTurnState, { type: "beginNewTurn", content: "问" });
  const streaming = { ...begun, conversationId: "c", turnId: "t", phase: "STREAMING" as const };
  expect(toAssistantMessage(streaming)?.createdAt).toBe(new Date(begun.startedAt!).toISOString());
  for (const event of [
    { event: "turn.completed" as const, data: { turnId: "t", messageId: "m", durationMs: 0 } },
    { event: "turn.failed" as const, data: { turnId: "t", messageId: "m", code: "AI_TURN_FAILED", durationMs: 125 } },
    { event: "turn.cancelled" as const, data: { turnId: "t", messageId: "m", durationMs: 325 } },
  ]) {
    const terminal = aiTurnReducer(streaming, { type: "event", event });
    expect(toAssistantMessage(terminal)?.durationMs).toBe(event.data.durationMs);
    expect(aiTurnReducer(terminal, { type: "network" }).durationMs).toBe(event.data.durationMs);
    expect(aiTurnReducer(terminal, { type: "beginRetryTurn", turnId: "t" }).durationMs).toBeUndefined();
  }
  expect(aiTurnReducer(streaming, { type: "cancel" }).durationMs).toBeGreaterThanOrEqual(0);
  expect(aiTurnReducer(streaming, { type: "network" }).durationMs).toBeGreaterThanOrEqual(0);
});

it("freezes unfinished tools on every terminal event without replacing real tool timings", () => {
  const startedAt = new Date(Date.now() - 1500).toISOString();
  const state = { ...initialAiTurnState, phase: "STREAMING" as const, tools: [
    { callId: "pending", toolName: "search_records", displayName: "查询", status: "RUNNING" as const, startedAt },
    { callId: "done", toolName: "search_records", displayName: "查询", status: "COMPLETED" as const, durationMs: 42 },
    { callId: "old", toolName: "search_records", displayName: "查询", status: "RUNNING" as const },
  ] };
  for (const event of [
    { event: "turn.completed" as const, data: { turnId: "t", messageId: "m" } },
    { event: "turn.failed" as const, data: { turnId: "t", messageId: "m", code: "AI_TURN_FAILED" } },
    { event: "turn.cancelled" as const, data: { turnId: "t", messageId: "m" } },
  ]) {
    const terminal = aiTurnReducer(state, { type: "event", event });
    expect(terminal.tools[0]?.durationMs).toBeGreaterThanOrEqual(1500);
    expect(terminal.tools[0]?.status).toBe("RUNNING");
    expect(terminal.tools[1]?.durationMs).toBe(42);
    expect(terminal.tools[2]?.durationMs).toBeUndefined();
    expect(aiTurnReducer(terminal, { type: "network" }).tools).toEqual(terminal.tools);
  }
});
