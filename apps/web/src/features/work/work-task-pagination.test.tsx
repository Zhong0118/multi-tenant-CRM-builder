vi.mock("@/features/work/work-goals", () => ({ WorkGoalsPanel: () => null }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/northwind/work",
  useSearchParams: () => new URLSearchParams(),
}));

import { TeamActivity } from "@/features/team-activity/team-activity";

import { MyWork } from "./my-work";
import type { WorkCounts, WorkTask, WorkTaskQuery } from "./work-api";

const transport = vi.hoisted(() => ({ GET: vi.fn(), PATCH: vi.fn() }));
vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: transport }));

const counts: WorkCounts = {
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

function setup(view: "mine" | "team", total = 101) {
  const tasks: WorkTask[] = Array.from({ length: total }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `任务 ${index + 1}`,
    notes: "",
    dueAt: "2026-10-22T10:00:00.000Z",
    status: "OPEN",
    result: "",
    completedAt: null,
    overdue: false,
    assigneeMemberId: index < 100 ? "m-1" : "m-2",
    assigneeName: index < 100 ? "孙悦" : "李昂",
    createdByMemberId: "boss",
    createdByName: "王总",
    version: 1,
    createdAt: "2026-10-21T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
    canComplete: index >= 100,
    canManage: false,
    canReassign: false,
  }));
  tasks.push({
    ...tasks[0],
    id: "done",
    title: "已完成的任务",
    status: "DONE",
  });
  transport.GET.mockImplementation(
    async (
      path: string,
      { params }: { params: { query?: WorkTaskQuery & { limit?: number } } },
    ) => {
      let data;
      if (path.endsWith("/work-tasks")) {
        const {
          page = 1,
          limit = 100,
          status,
          assigneeMemberId,
        } = params.query ?? {};
        const matching = tasks.filter(
          (task) =>
            (!status || task.status === status) &&
            (!assigneeMemberId || task.assigneeMemberId === assigneeMemberId),
        );
        data = {
          items: matching.slice((page - 1) * limit, page * limit),
          page,
          limit,
          total: matching.length,
        };
      } else if (path.endsWith("/team-activity")) {
        data = {
          timezone: "Asia/Shanghai",
          today: "2026-10-22",
          from: "2026-10-22",
          to: "2026-10-22",
          members: [
            {
              ...counts,
              memberId: "m-1",
              name: "孙悦",
              role: "EMPLOYEE",
              status: "ACTIVE",
            },
            {
              ...counts,
              memberId: "m-2",
              name: "李昂",
              role: "EMPLOYEE",
              status: "ACTIVE",
            },
          ],
          totals: counts,
        };
      } else if (path.endsWith("/daily-reports/{workDate}/mine")) {
        data = {
          workDate: "2026-10-22",
          today: "2026-10-22",
          memberId: "m-1",
          memberName: "孙悦",
          canEdit: true,
          report: null,
          reference: { counts, tasks: [] },
        };
      } else {
        throw new Error(`Unexpected GET ${path}`);
      }
      return { data, response: new Response(null, { status: 200 }) };
    },
  );
  transport.PATCH.mockImplementation(
    async (
      _path: string,
      {
        params,
        body,
      }: {
        params: { path: { taskId: string } };
        body: { status: WorkTask["status"]; result: string };
      },
    ) => {
      const task = tasks.find((item) => item.id === params.path.taskId)!;
      Object.assign(task, body, { version: task.version + 1 });
      return { data: task, response: new Response(null, { status: 200 }) };
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  render(
    <QueryClientProvider client={client}>
      {view === "mine" ? (
        <MyWork tenantCode="northwind" />
      ) : (
        <TeamActivity tenantCode="northwind" memberId="admin-1" />
      )}
    </QueryClientProvider>,
  );
  return { tasks, client };
}

beforeEach(() => vi.resetAllMocks());

describe.each(["mine", "team"] as const)("%s task pagination", (view) => {
  it("reaches tasks beyond the first 100 and returns to the first page", async () => {
    setup(view);
    await screen.findByText("任务 1");
    expect(screen.queryByText("任务 101")).not.toBeInTheDocument();
    expect(screen.getByText("共 101 项")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("任务 101")).toBeInTheDocument();
    expect(screen.queryByText("任务 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("1"));
    expect(await screen.findByText("任务 1")).toBeInTheDocument();
  });

  it("starts from page one after changing the status filter", async () => {
    setup(view);
    await screen.findByText("任务 1");
    fireEvent.click(screen.getByTitle("2"));
    await screen.findByText("任务 101");
    fireEvent.click(screen.getByText("已完成"));
    expect(await screen.findByText("已完成的任务")).toBeInTheDocument();
    expect(screen.queryByText("任务 101")).not.toBeInTheDocument();
    expect(screen.getByText("共 1 项")).toBeInTheDocument();
  });

  it("allows a previously removed last page to become reachable again", async () => {
    const { tasks, client } = setup(view);
    await screen.findByText("任务 1");
    fireEvent.click(screen.getByTitle("2"));
    const item = (await screen.findByText("任务 101")).closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: /^完\s?成$/ }));
    fireEvent.click(within(item).getByText("标记完成"));
    await screen.findByText("共 100 项");
    await screen.findByText("任务 1");

    tasks.push({ ...tasks[0], id: "new-task", title: "新任务" });
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["workspace", "northwind", "work-tasks"],
      });
    });
    await screen.findByText("共 101 项");
    fireEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("新任务")).toBeInTheDocument();
    expect(screen.queryByText("任务 1")).not.toBeInTheDocument();
  });

  it.each([
    { total: 101, remaining: "任务 1" },
    { total: 102, remaining: "任务 102" },
  ])(
    "refreshes after completion with $total tasks, retaining a valid page",
    async ({ total, remaining }) => {
      setup(view, total);
      await screen.findByText("任务 1");
      fireEvent.click(screen.getByTitle("2"));
      const item = (await screen.findByText("任务 101")).closest("li")!;
      fireEvent.click(within(item).getByRole("button", { name: /^完\s?成$/ }));
      fireEvent.click(within(item).getByText("标记完成"));
      expect(await screen.findByText(`共 ${total - 1} 项`)).toBeInTheDocument();
      expect(await screen.findByText(remaining)).toBeInTheDocument();
      expect(screen.queryByText("任务 101")).not.toBeInTheDocument();
    },
  );
});

it("starts team tasks from page one after changing the assignee filter", async () => {
  setup("team");
  await screen.findByText("任务 1");
  fireEvent.click(screen.getByTitle("2"));
  await screen.findByText("任务 101");
  fireEvent.mouseDown(screen.getByLabelText("负责人"));
  fireEvent.click(screen.getAllByText("孙悦").at(-1)!);
  expect(await screen.findByText("任务 1")).toBeInTheDocument();
  expect(screen.queryByText("任务 101")).not.toBeInTheDocument();
  expect(screen.getByText("共 100 项")).toBeInTheDocument();
});
