import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonalFollowUpWorkbench } from "./follow-up-workbench";
import type { followUpApi } from "./follow-up-api";

const item = {
  id: "task-1",
  recordId: "record-1",
  recordTitle: "项目 A",
  objectCode: "opportunities",
  objectName: "商机",
  title: "确认客户反馈",
  dueAt: "2026-09-17T01:00:00.000Z",
  version: 3,
  overdue: false,
  canManage: true,
};

const workbench = {
  timezone: "Asia/Shanghai",
  counts: { allOpen: 9, overdue: 2, today: 1, upcoming: 4 },
  preview: {
    overdue: [
      { ...item, id: "overdue-1", title: "逾期跟进", overdue: true },
    ],
    today: [item],
    upcoming: [
      {
        ...item,
        id: "upcoming-1",
        title: "近期跟进",
        dueAt: "2026-09-18T01:00:00.000Z",
      },
    ],
  },
};

function setup(
  payload: typeof workbench = workbench,
  options: { fail?: boolean } = {},
) {
  const api = {
    recipients: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      openCount: 0,
      overdueCount: 0,
    }),
    create: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockResolvedValue(item),
    // The failure has to be armed before the first render, otherwise the query
    // has already resolved and the component legitimately shows data.
    workbench: options.fail
      ? vi.fn().mockRejectedValue(new Error("network unavailable"))
      : vi.fn().mockResolvedValue(payload),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <span data-testid="page-sibling">dashboard</span>
      <PersonalFollowUpWorkbench
        tenantCode="northwind"
        api={api as unknown as typeof followUpApi}
      />
    </QueryClientProvider>,
  );
  return api;
}

describe("PersonalFollowUpWorkbench", () => {
  it("renders the full-set counts and the three preview buckets", async () => {
    setup();

    expect(await screen.findByTestId("workbench-count-all")).toHaveTextContent(
      "9",
    );
    expect(screen.getByTestId("workbench-count-overdue")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("workbench-count-today")).toHaveTextContent("1");
    expect(screen.getByTestId("workbench-count-upcoming")).toHaveTextContent(
      "4",
    );

    expect(screen.getByTestId("workbench-bucket-overdue")).toHaveTextContent(
      "逾期跟进",
    );
    expect(screen.getByTestId("workbench-bucket-today")).toHaveTextContent(
      "确认客户反馈",
    );
    expect(screen.getByTestId("workbench-bucket-upcoming")).toHaveTextContent(
      "近期跟进",
    );
    expect(
      screen.getByRole("link", { name: "查看全部跟进" }),
    ).toHaveAttribute("href", "/workspace/northwind/follow-ups");
  });

  it("links each item to its record and renders the due time in the tenant zone", async () => {
    setup();

    const link = await screen.findByTestId("workbench-link-task-1");
    expect(link).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/opportunities/record-1",
    );
    // 2026-09-17T01:00:00Z is 09:00 on 09/17 in Asia/Shanghai, so a browser- or
    // UTC-rendered time would be caught here.
    expect(screen.getByTestId("workbench-item-task-1")).toHaveTextContent(
      "09/17 09:00",
    );
  });

  it("shows no Complete button for items the actor cannot manage", async () => {
    setup({
      ...workbench,
      preview: {
        overdue: [],
        today: [{ ...item, canManage: false }],
        upcoming: [],
      },
    });

    await screen.findByTestId("workbench-bucket-today");
    expect(screen.queryByTestId("workbench-complete-task-1")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("completes through the existing versioned PATCH and refetches", async () => {
    const api = setup();

    fireEvent.click(await screen.findByTestId("workbench-complete-task-1"));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
        version: 3,
        status: "DONE",
      }),
    );
    await waitFor(() => expect(api.workbench).toHaveBeenCalledTimes(2));
  });

  it("isolates a workbench failure from the rest of the page", async () => {
    const api = setup(workbench, { fail: true });

    expect(
      await screen.findByText("跟进事项暂时无法加载"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("page-sibling")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workbench-retry"));

    await waitFor(() => expect(api.workbench).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("page-sibling")).toBeInTheDocument();
  });
});
