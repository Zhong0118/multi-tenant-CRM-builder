import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "./assistant-message";
import { aiTurnReducer, initialAiTurnState, toAssistantMessage } from "./ai-turn-reducer";
import type { AiMessage } from "./ai-types";

const failed = { callId: "f", toolName: "search_records", displayName: "查询客户", status: "FAILED" as const, detail: "查询条件需要调整", errorCode: "INVALID_TOOL_ARGUMENT", durationMs: 1200 };
const base: AiMessage = { id: "a", conversationId: "c", turnId: "t", role: "ASSISTANT", status: "COMPLETED", content: "已有结果", toolSummary: [failed], sourceSummary: [], createdAt: "2026-10-15T00:00:00Z", durationMs: 2500 };
afterEach(() => vi.useRealTimers());
describe("assistant query outcomes", () => {
  it("shows actual failed count and safe detail, retries the original turn", () => {
    const retry = vi.fn();
    render(<AssistantMessage tenantCode="demo" message={base} onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: /1 项失败/ }));
    expect(screen.getByText("查询条件需要调整")).toBeInTheDocument();
    expect(screen.getByText("1.2 秒")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledWith("t");
    expect(screen.queryByText("已完成的查询")).not.toBeInTheDocument();
  });
  it("counts mixed results separately and uses neutral history copy", () => {
    render(<AssistantMessage tenantCode="demo" message={{ ...base, toolSummary: [{ ...failed, detail: undefined, errorCode: undefined }, { ...failed, callId: "ok", status: "COMPLETED" }] }} />);
    expect(screen.getByRole("button", { name: /1 项成功.*1 项失败/ })).toBeInTheDocument();
    expect(screen.getByText("部分查询未成功，可展开查看")).toBeInTheDocument();
  });
  it("does not retry a turn with a proposal or while a mutation is busy", () => {
    const view = render(<AssistantMessage tenantCode="demo" message={base} onRetry={vi.fn()} proposalBusy />);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    view.rerender(<AssistantMessage tenantCode="demo" message={{ ...base, proposal: { proposalId: "p", operation: "UPDATE_RECORD", title: "更新", targetSummary: "客户", changes: [], validationWarnings: [], expiresAt: "2999-01-01", status: "EXECUTED", failureCode: null, auditId: null, result: null } }} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });
  it.each(["COMPLETED", "FAILED", "CANCELLED"])("ticks only during streaming and freezes %s attempt duration", (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
    const view = render(<AssistantMessage tenantCode="demo" message={{ ...base, status: "STREAMING", durationMs: undefined }} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("已用时 3.0 秒")).toBeInTheDocument();
    view.rerender(<AssistantMessage tenantCode="demo" message={{ ...base, status }} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText("本轮用时 2.5 秒")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it.each(["cancel", "network"] as const)("preserves the running tool duration after %s", (type) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  let state = aiTurnReducer(initialAiTurnState, { type: "beginNewTurn", content: "问" });
  state = { ...state, phase: "STREAMING", conversationId: "c", turnId: "t", tools: [{ callId: "x", toolName: "search_records", displayName: "查询", status: "RUNNING", startedAt: "2026-10-15T00:00:00Z" }] };
  const view = render(<AssistantMessage tenantCode="demo" message={toAssistantMessage(state)!} />);
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("3.0 秒")).toBeInTheDocument();
  state = aiTurnReducer(state, { type });
  view.rerender(<AssistantMessage tenantCode="demo" message={toAssistantMessage(state)!} />);
  fireEvent.click(screen.getByRole("button", { name: /1 项已中断/ }));
  expect(screen.getByText("已中断")).toBeInTheDocument();
  expect(screen.getByText("3.0 秒")).toBeVisible();
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText("3.0 秒")).toBeVisible();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not use the original row creation time as a historical retry attempt clock", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  render(<AssistantMessage tenantCode="demo" message={{ ...base, status: "GENERATING", createdAt: "2026-01-01T00:00:00Z", durationMs: undefined }} />);
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText(/已用时/)).not.toBeInTheDocument();
});

it("keeps an interrupted historical tool duration at the authoritative completion time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
  render(<AssistantMessage tenantCode="demo" message={{ ...base, status: "CANCELLED", completedAt: "2026-10-15T00:00:03Z", toolSummary: [{ callId: "x", toolName: "search_records", displayName: "查询", status: "RUNNING", startedAt: "2026-10-15T00:00:00Z" }] }} />);
  fireEvent.click(screen.getByRole("button", { name: /1 项已中断/ }));
  expect(screen.getByText("3.0 秒")).toBeVisible();
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText("3.0 秒")).toBeVisible();
  expect(vi.getTimerCount()).toBe(0);
});
