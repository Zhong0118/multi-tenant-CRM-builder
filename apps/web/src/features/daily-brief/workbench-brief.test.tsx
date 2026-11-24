import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BriefSuggestions } from "./workbench-brief";
const { suggestions } = vi.hoisted(() => ({ suggestions: vi.fn() }));
vi.mock("./brief-api", () => ({
  briefApi: {
    suggestions,
  },
}));
suggestions.mockResolvedValue({
  localDate: "2026-11-24",
  items: [],
  generatedAt: null,
  remaining: 3,
  busy: false,
});
it("remembers the collapsed suggestions for the same person only", async () => {
  const mount = (memberId: string) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BriefSuggestions
          tenantCode="local"
          memberId={memberId}
          localDate="2026-11-24"
          timezone="Asia/Shanghai"
          hasCandidates
        />
      </QueryClientProvider>,
    );
  let v = mount("one");
  fireEvent.click(await screen.findByRole("button", { name: "收起今日建议" }));
  expect(screen.queryByRole("button", { name: "生成今日建议" })).toBeNull();
  v.unmount();
  v = mount("one");
  expect(
    await screen.findByRole("button", { name: "展开今日建议" }),
  ).toBeInTheDocument();
  v.unmount();
  mount("two");
  expect(
    await screen.findByRole("button", { name: "生成今日建议" }),
  ).toBeInTheDocument();
});

it.each([
  [true, "本次 AI 建议均未通过校验"],
  [false, "上次的建议已不适用于当前记录"],
])(
  "explains an empty generation when there is still work to do",
  async (noValidatedSuggestions, message) => {
    suggestions.mockResolvedValueOnce({
      localDate: "2026-11-24",
      generatedAt: "2026-11-24T08:00:00Z",
      remaining: 0,
      busy: false,
      items: [],
      noValidatedSuggestions,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BriefSuggestions
          tenantCode="local"
          memberId="three"
          localDate="2026-11-24"
          timezone="Asia/Shanghai"
          hasCandidates
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(new RegExp(message as string)),
    ).toBeVisible();
  },
);
