import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAiSettings } from "./settings-panel";
import { workspaceAi, type Settings } from "./workspace-api";
vi.mock("./usage-panel", () => ({ UsagePanel: () => <p>当月用量视图</p> }));
const state: Settings = {
  tenantId: "a",
  name: "甲",
  code: "a",
  planId: "p",
  planName: "基础版",
  planVersion: 1,
  version: 1,
  startedAt: "2026-11-01",
  month: "2026-11-01",
  restoresAt: "2026-12-01",
  disabled: false,
  totalTokens: "120000",
  baseTokens: "120000",
  extraTokens: "0",
  usedTokens: "1000",
  remainingTokens: "119000",
  reservedTokens: "0",
  percent: 0.83,
  allocation: "shared",
  features: ["assistant", "filter"],
  preview: {
    members: 3,
    shareTokens: "40000",
    overShare: 1,
    confirmation: "snapshot",
  },
};
function show() {
  vi.spyOn(workspaceAi, "settings").mockResolvedValue(state);
  vi.spyOn(workspaceAi, "usage").mockResolvedValue({
    month: state.month,
    daily: [],
    members: [],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkspaceAiSettings memberId="admin" tenantCode="a" />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.restoreAllMocks());
describe("company AI settings", () => {
  it("lists all five capabilities with contact instructions for excluded features", async () => {
    show();
    await screen.findByText("基础版");
    for (const name of [
      "对话助手",
      "AI 写入提议",
      "整理沟通",
      "一句话筛选",
      "AI 建表",
    ])
      expect(screen.getByText(name)).toBeVisible();
    expect(
      screen.getAllByText("当前套餐不含，如需开通请联系平台"),
    ).toHaveLength(3);
  });
  it("uses the displayed roster confirmation and only commits after admin confirmation", async () => {
    const save = vi
      .spyOn(workspaceAi, "allocate")
      .mockResolvedValue({ ...state, allocation: "equal" });
    show();
    fireEvent.click(await screen.findByText("按人均分"));
    expect(screen.getByText("每人约 4 万 token · 已超份额 1 人")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认切换" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("a", "equal", "snapshot"),
    );
  });
});
