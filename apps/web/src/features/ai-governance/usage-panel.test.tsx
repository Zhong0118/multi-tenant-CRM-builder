import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UsagePanel } from "./usage-panel";
import type { Settings, Usage } from "./workspace-api";
import { catalogFixture } from "./catalog.fixture";

vi.mock("next/dynamic", () => ({ default: () => () => <p>趋势图</p> }));

const state = {
  catalog: catalogFixture,
  allocation: "shared",
  totalTokens: "1000000",
  usedTokens: "30000",
  preview: { members: 3, shareTokens: null, overShare: 0 },
} as unknown as Settings;
const member = (memberId: string, name: string, usedTokens: string) => ({
  memberId,
  name,
  active: true,
  usedTokens,
  reservedTokens: "0",
});
const day = (date: string, inputTokens: number) => ({
  date,
  feature: "assistant",
  inputTokens: String(inputTokens),
  outputTokens: "0",
  proposals: "0",
  confirmations: "0",
});

it("reads under a week of usage as numbers and hides members who used nothing", () => {
  render(
    <UsagePanel
      state={state}
      usage={
        {
          month: "2026-11-01",
          daily: [day("2026-11-25", 10000), day("2026-11-26", 20000)],
          members: [
            member("a", "刘洋", "30000"),
            member("b", "赵晨", "0"),
            member("c", "钱宇", "0"),
          ],
        } as unknown as Usage
      }
    />,
  );
  expect(screen.queryByText("趋势图")).toBeNull();
  expect(screen.getByText("11月25日")).toBeInTheDocument();
  expect(screen.getByText("11月26日")).toBeInTheDocument();
  expect(screen.getByText("刘洋")).toBeInTheDocument();
  expect(screen.queryByText("赵晨")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "显示全部 3 人" }));
  expect(screen.getByText("赵晨")).toBeInTheDocument();
});
