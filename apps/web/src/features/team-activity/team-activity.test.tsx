import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkApi } from "@/features/work/work-api";

import { TeamActivity, teamActivityApi, type Period } from "./team-activity";

const counts = {
  calls: 0,
  connectedCalls: 0,
  messages: 0,
  wechatAdded: 0,
  visits: 0,
  notes: 0,
  customersFollowed: 0,
  leadsClaimed: 0,
  contactsConfirmed: 0,
  recordsCreated: 0,
  followUpsDone: 0,
  followUpsOverdue: 0,
  followUpsOverdueInPeriod: 0,
  tasksDone: 0,
  tasksOverdue: 0,
  tasksOverdueInPeriod: 0,
  reportsWritten: 0,
};

function setup() {
  const summarize = vi.fn(async (_tenant: string, period: Period) => ({
    timezone: "Asia/Shanghai",
    today: "2026-10-22",
    from:
      "preset" in period && period.preset === "month"
        ? "2026-10-01"
        : "2026-10-22",
    to: "2026-10-22",
    members: [
      {
        ...counts,
        memberId: "m-1",
        name: "孙悦",
        role: "EMPLOYEE" as const,
        status: "ACTIVE" as const,
        calls: 12,
        connectedCalls: 4,
        wechatAdded: 3,
        tasksOverdue: 1,
      },
      {
        ...counts,
        memberId: "m-2",
        name: "李昂",
        role: "EMPLOYEE" as const,
        status: "ACTIVE" as const,
        visits: 1,
      },
    ],
    totals: {
      ...counts,
      calls: 12,
      connectedCalls: 4,
      wechatAdded: 3,
      visits: 1,
      tasksOverdue: 1,
    },
  }));
  const work = {
    listTasks: vi.fn(async () => ({
      items: [],
      page: 1,
      limit: 100,
      total: 0,
    })),
    createTask: vi.fn(async () => ({})),
    memberReport: vi.fn(
      async (_t: string, workDate: string, memberId: string) => ({
        workDate,
        today: "2026-10-22",
        memberId,
        memberName: "孙悦",
        canEdit: false,
        report: {
          id: "r-1",
          workDate,
          plans: "拜访两家",
          completed: "签了一单",
          problems: "",
          nextSteps: "回款",
          version: 1,
          updatedAt: "2026-10-22T10:00:00.000Z",
        },
        reference: { counts: { ...counts, calls: 12 }, tasks: [] },
      }),
    ),
  } as unknown as WorkApi;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamActivity
        tenantCode="northwind"
        api={{ ...teamActivityApi, summarize }}
        work={work}
      />
    </QueryClientProvider>,
  );
  return { summarize, work };
}

describe("TeamActivity", () => {
  it("asks the server for today in the company calendar and shows grouped, sourced counts", async () => {
    const { summarize } = setup();
    const row = (await screen.findByText("孙悦")).closest("tr")!;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("合计")).toBeInTheDocument();
    expect(summarize.mock.calls[0][1]).toEqual({ preset: "today" });
    expect(screen.getAllByText("新加微信")[0]).toHaveAttribute(
      "title",
      expect.stringContaining("只算第一次"),
    );
    expect(screen.getByText("2026-10-22（Asia/Shanghai）")).toBeInTheDocument();
  });

  it("lets the server resolve 本月", async () => {
    const { summarize } = setup();
    await screen.findByText("孙悦");
    fireEvent.click(screen.getByRole("radio", { name: "本月" }));
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(2));
    expect(summarize.mock.calls[1][1]).toEqual({ preset: "month" });
  });

  it("assigns a task to a member from their row", async () => {
    const { work } = setup();
    const row = (await screen.findByText("李昂")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "安排任务" }));
    const form = await screen.findByRole("form", { name: "给李昂安排任务" });
    fireEvent.change(within(form).getByLabelText("任务标题"), {
      target: { value: "整理报价单" },
    });
    fireEvent.click(within(form).getByRole("button", { name: /^安\s?排$/ }));
    await waitFor(() =>
      expect(work.createTask).toHaveBeenCalledWith(
        "northwind",
        expect.objectContaining({
          title: "整理报价单",
          assigneeMemberId: "m-2",
        }),
      ),
    );
  });

  it("opens a member's report for a single day beside what the system recorded", async () => {
    const { work } = setup();
    const row = (await screen.findByText("孙悦")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "看日报" }));
    expect(await screen.findByText("签了一单")).toBeInTheDocument();
    expect(screen.getByLabelText("当天记录")).toHaveTextContent("12（接通 0）");
    expect(work.memberReport).toHaveBeenCalledWith(
      "northwind",
      "2026-10-22",
      "m-1",
    );
  });
});
