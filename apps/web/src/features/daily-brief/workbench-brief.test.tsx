import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BriefSuggestions } from "./workbench-brief";
vi.mock("./brief-api", () => ({
  briefApi: {
    suggestions: async () => ({
      localDate: "2026-11-24",
      items: [],
      generatedAt: null,
      remaining: 3,
      busy: false,
    }),
  },
}));
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
