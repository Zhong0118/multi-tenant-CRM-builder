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

it("opens the manageable overdue task and only offers creation when the record has no such task", async () => {
  const task = {
    recordId: "record",
    objectCode: "deals",
    title: "远山",
    objectName: "商机",
    suggestedTitle: "确认交期",
    explanation: "",
    reason: "商机阶段：方案报价",
    canFollowUp: true,
  };
  suggestions.mockResolvedValueOnce({
    generatedAt: "2026-11-24T08:00:00Z",
    remaining: 2,
    items: [
      { ...task, overdueFollowUpId: "task-42" },
      { ...task, recordId: "new", overdueFollowUpId: null },
      {
        ...task,
        recordId: "readOnly",
        canFollowUp: false,
        overdueFollowUpId: null,
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BriefSuggestions
        tenantCode="local"
        memberId="actor"
        localDate="2026-11-24"
        timezone="UTC"
        hasCandidates
      />
    </QueryClientProvider>,
  );
  const manage = await screen.findByRole("link", { name: "去处理这条跟进" });
  expect(manage).toHaveAttribute(
    "href",
    expect.stringContaining("/objects/deals/record?followUp=task-42"),
  );
  expect(screen.getAllByRole("link", { name: "加跟进" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "加跟进" })).toHaveAttribute(
    "href",
    expect.stringContaining("/deals/new?section=followups"),
  );
  expect(screen.queryByText("确认交期。")).toBeNull();
});

it("opens the record from the row, keeps the reason behind ⓘ and only mentions the limit once it is used up", async () => {
  suggestions.mockResolvedValueOnce({
    generatedAt: "2026-11-24T08:00:00Z",
    remaining: 2,
    items: [
      {
        recordId: "record",
        objectCode: "deals",
        title: "远山",
        objectName: "商机",
        suggestedTitle: "确认交期",
        explanation: "",
        reason: "商机阶段：方案报价",
        canFollowUp: true,
        overdueFollowUpId: null,
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BriefSuggestions
        tenantCode="local"
        memberId="actor"
        localDate="2026-11-24"
        timezone="UTC"
        hasCandidates
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("link", { name: "确认交期" })).toHaveAttribute(
    "href",
    expect.stringContaining("/objects/deals/record"),
  );
  expect(
    screen.getByRole("button", { name: "依据：商机阶段：方案报价" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("商机阶段：方案报价")).toBeNull();
  expect(screen.queryByRole("link", { name: "打开记录" })).toBeNull();
  expect(screen.queryByText(/还可重新生成|已用完/)).toBeNull();
});
