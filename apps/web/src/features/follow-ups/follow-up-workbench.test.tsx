import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonalFollowUpWorkbench } from "./follow-up-workbench";
import type { followUpApi } from "./follow-up-api";
import type { WorkApi, WorkTask } from "@/features/work/work-api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/northwind/dashboards/sales",
  useSearchParams: () => new URLSearchParams("from=2026-10-01&to=2026-10-04"),
}));

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
  pendingContacts: {
    count: 1,
    items: [
      {
        recordId: "lead-1",
        recordTitle: "王老师",
        objectCode: "customers",
        objectName: "客户",
        stageLabel: "已加微信",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ],
  },
  preview: {
    overdue: [{ ...item, id: "overdue-1", title: "逾期跟进", overdue: true }],
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
  options: {
    fail?: boolean;
    tasks?: WorkTask[];
    taskFail?: boolean;
    total?: number;
  } = {},
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
  const work = {
    listTasks: options.taskFail
      ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockResolvedValue({
          items: options.tasks ?? [],
          total: options.total ?? options.tasks?.length ?? 0,
          page: 1,
          limit: 100,
        }),
  } as unknown as WorkApi;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <span data-testid="page-sibling">dashboard</span>
      <PersonalFollowUpWorkbench
        tenantCode="northwind"
        api={api as unknown as typeof followUpApi}
        work={work}
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
    expect(screen.getByRole("link", { name: "查看全部跟进" })).toHaveAttribute(
      "href",
      "/workspace/northwind/follow-ups",
    );
  });

  it("links each item to its record and renders the due time in the tenant zone", async () => {
    setup();

    const link = await screen.findByTestId("workbench-link-task-1");
    expect(link).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/opportunities/record-1?followUp=task-1&returnTo=%2Fworkspace%2Fnorthwind%2Fdashboards%2Fsales%3Ffrom%3D2026-10-01%26to%3D2026-10-04",
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

  it("lists claimed leads still waiting for contact, linked to the record", async () => {
    setup();
    const section = await screen.findByRole("region", { name: "待联系客户" });
    expect(section).toHaveTextContent("客户 · 已加微信");
    expect(screen.getByRole("link", { name: "王老师" })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/customers/lead-1",
    );
  });

  it("completes through the existing versioned PATCH and refetches", async () => {
    const api = setup();

    fireEvent.click(await screen.findByTestId("workbench-complete-task-1"));
    fireEvent.change(await screen.findByLabelText("完成结果"), { target: { value: "  已确认反馈  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
        version: 3,
        status: "DONE",
        completionResult: { activityType: "NOTE", content: "已确认反馈" },
      }),
    );
    await waitFor(() => expect(api.workbench).toHaveBeenCalledTimes(2));
  });

  it("isolates a workbench failure from the rest of the page", async () => {
    const api = setup(workbench, { fail: true });

    expect(await screen.findByText("跟进事项暂时无法加载")).toBeInTheDocument();
    expect(screen.getByTestId("page-sibling")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workbench-retry"));

    await waitFor(() => expect(api.workbench).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("page-sibling")).toBeInTheDocument();
  });
});

it("keeps task errors visible when follow-ups and contacts are empty", async () => {
  setup(
    {
      ...workbench,
      preview: { overdue: [], today: [], upcoming: [] },
      pendingContacts: { count: 0, items: [] },
    },
    { taskFail: true },
  );
  expect(await screen.findByText("任务暂时无法加载")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^重\s*试$/ })).toBeInTheDocument();
  expect(
    screen.queryByText("今天没有需要处理的跟进事项，也没有进行中的任务。"),
  ).not.toBeInTheDocument();
});

it("uses the server task total instead of the first page length", async () => {
  const tasks = Array.from(
    { length: 100 },
    (_, index) =>
      ({
        id: `many-${index}`,
        title: `任务${index}`,
        status: "OPEN",
        dueAt: "2099-01-01T00:00:00Z",
        createdByMemberId: "me",
        assigneeMemberId: "me",
      }) as WorkTask,
  );
  setup(workbench, { tasks, total: 150 });
  expect(await screen.findByText("150 项进行中")).toBeInTheDocument();
  expect(screen.getByText("还有 145 项，去任务与日报")).toBeInTheDocument();
});
