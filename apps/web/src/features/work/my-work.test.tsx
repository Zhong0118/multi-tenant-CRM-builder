vi.mock("@/features/work/work-goals", () => ({ WorkGoalsPanel: () => null }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/northwind/work",
  useSearchParams: () => new URLSearchParams(),
}));

import { MyWork } from "./my-work";
import type { WorkApi, WorkTask } from "./work-api";

const counts = {
  calls: 2,
  connectedCalls: 1,
  messages: 3,
  wechatAdded: 1,
  visits: 0,
  notes: 0,
  customersFollowed: 2,
  leadsClaimed: 0,
  contactsConfirmed: 1,
  recordsCreated: 0,
  followUpsDone: 1,
  followUpsOverdue: 0,
  followUpsOverdueInPeriod: 0,
  tasksDone: 1,
  tasksOverdue: 0,
  tasksOverdueInPeriod: 0,
  reportsWritten: 0,
};

const assigned: WorkTask = {
  id: "t-1",
  title: "整理本周报价单",
  notes: "按客户分组",
  dueAt: "2026-10-22T10:00:00.000Z",
  status: "OPEN",
  result: "",
  completedAt: null,
  overdue: false,
  assigneeMemberId: "me",
  assigneeName: "孙悦",
  createdByMemberId: "boss",
  createdByName: "王总",
  version: 3,
  createdAt: "2026-10-21T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
  canComplete: true,
  canManage: false,
  canReassign: false,
};

function setup(
  report: null | { version: number } = null,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const api = {
    listTasks: vi.fn(async () => ({
      items: [assigned],
      page: 1,
      limit: 100,
      total: 1,
    })),
    createTask: vi.fn(async () => assigned),
    updateTask: vi.fn(async () => ({ ...assigned, status: "DONE" })),
    myReport: vi.fn(async () => ({
      workDate: "2026-10-22",
      today: "2026-10-22",
      memberId: "me",
      memberName: "孙悦",
      canEdit: true,
      report: report
        ? {
            id: "r-1",
            workDate: "2026-10-22",
            plans: "",
            completed: "旧内容",
            problems: "",
            nextSteps: "",
            version: report.version,
            updatedAt: "2026-10-22T09:00:00.000Z",
          }
        : null,
      reference: {
        counts,
        tasks: [
          {
            id: "t-0",
            title: "回访老客户",
            status: "DONE" as const,
            dueAt: "2026-10-22T08:00:00.000Z",
            completedAt: "2026-10-22T07:00:00.000Z",
            result: "两家续约",
          },
        ],
      },
    })),
    saveReport: vi.fn(
      async (
        _tenant: string,
        workDate: string,
        input: Parameters<WorkApi["saveReport"]>[2],
      ) => ({
        ...input,
        id: "r-1",
        workDate,
        version: input.version + 1,
        updatedAt: "2026-10-22T10:00:00.000Z",
      }),
    ),
  } as unknown as WorkApi;
  render(
    <QueryClientProvider client={client}>
      <MyWork tenantCode="northwind" api={api} />
    </QueryClientProvider>,
  );
  return api;
}

describe("MyWork", () => {
  it("completes an assigned task with a written result, without offering to change its plan", async () => {
    const api = setup();
    const item = (await screen.findByText("整理本周报价单")).closest("li")!;
    expect(within(item).getByText("由 王总 安排")).toBeInTheDocument();
    expect(
      within(item).queryByRole("button", { name: "取消任务" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(item).getByRole("button", { name: /^完\s?成$/ }));
    fireEvent.change(within(item).getByLabelText("整理本周报价单 的结果"), {
      target: { value: "已发给 3 家客户" },
    });
    await waitFor(() => expect(api.myReport).toHaveBeenCalled());
    const reportLoads = vi.mocked(api.myReport).mock.calls.length;
    fireEvent.click(within(item).getByRole("button", { name: "标记完成" }));
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith("northwind", "t-1", {
        version: 3,
        status: "DONE",
        result: "已发给 3 家客户",
      }),
    );
    // The report beside it shows the system's task record, so it reloads too.
    await waitFor(() =>
      expect(vi.mocked(api.myReport).mock.calls.length).toBeGreaterThan(
        reportLoads,
      ),
    );
  });

  it("opens today's report in the company calendar and creates it with version 0", async () => {
    const api = setup();
    const form = await screen.findByRole("form", { name: "2026-10-22 日报" });
    expect(api.myReport).toHaveBeenCalledWith("northwind", "today");
    // The day's records stay beside the report, read-only.
    expect(screen.getByLabelText("当天记录")).toHaveTextContent("2（接通 1）");
    fireEvent.click(
      within(form).getByRole("button", { name: "填入当天完成的任务" }),
    );
    expect(within(form).getByLabelText("完成情况")).toHaveValue(
      "· 回访老客户：两家续约",
    );
    fireEvent.change(within(form).getByLabelText("遇到的问题"), {
      target: { value: "报价审批慢" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "保存日报" }));
    await waitFor(() =>
      expect(api.saveReport).toHaveBeenCalledWith("northwind", "2026-10-22", {
        version: 0,
        plans: "",
        completed: "· 回访老客户：两家续约",
        problems: "报价审批慢",
        nextSteps: "",
      }),
    );
  });

  it("edits an existing report at its version", async () => {
    const api = setup({ version: 4 });
    const form = await screen.findByRole("form", { name: "2026-10-22 日报" });
    expect(within(form).getByLabelText("完成情况")).toHaveValue("旧内容");
    // Nothing to save until something changes.
    expect(
      within(form).getByRole("button", { name: "保存日报" }),
    ).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("完成情况"), {
      target: { value: "旧内容，补充一条" },
    });
    expect(
      within(form).getByText("有未保存的修改（已暂存在本机）"),
    ).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "保存日报" }));
    await waitFor(() =>
      expect(api.saveReport).toHaveBeenCalledWith(
        "northwind",
        "2026-10-22",
        expect.objectContaining({ version: 4, completed: "旧内容，补充一条" }),
      ),
    );
  });

  it("offers back an unsaved draft kept from before a reload", async () => {
    window.localStorage.setItem(
      "crm.daily-report-draft.v1.northwind.me.2026-10-22",
      JSON.stringify({
        sections: {
          plans: "",
          completed: "刷新前写的",
          problems: "",
          nextSteps: "",
        },
        savedAt: "2099-01-01T00:00:00.000Z",
      }),
    );
    setup({ version: 4 });
    const form = await screen.findByRole("form", { name: "2026-10-22 日报" });
    expect(within(form).getByLabelText("完成情况")).toHaveValue("旧内容");
    fireEvent.click(within(form).getByRole("button", { name: "恢复草稿" }));
    expect(within(form).getByLabelText("完成情况")).toHaveValue("刷新前写的");
    window.localStorage.clear();
  });
});

describe("daily report recovery safety", () => {
  const key = "crm.daily-report-draft.v1.northwind.me.2026-10-22";
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("preserves local edits when a newer server revision arrives", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const api = setup({ version: 4 }, client);
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "必须保留的本地修改" },
    });
    const initial: Awaited<ReturnType<WorkApi["myReport"]>> = await vi.mocked(
      api.myReport,
    ).mock.results[0].value;
    vi.mocked(api.myReport).mockResolvedValue({
      ...initial,
      report: {
        ...initial.report!,
        completed: "另一端的新内容",
        version: 5,
        updatedAt: "2099-01-01T00:00:00Z",
      },
    });
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["workspace", "northwind", "daily-report"],
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("完成情况")).toHaveValue(
        "必须保留的本地修改",
      ),
    );
    expect(window.localStorage.getItem(key)).toContain("必须保留的本地修改");
  });

  it("clears the cached draft when the user confirms discard", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "明确放弃的修改" },
    });
    render(<Link href="/workspace/northwind/other">离开日报</Link>);
    fireEvent.click(screen.getByText("离开日报"));
    const dialog = await screen.findByRole("dialog", {
      name: "放弃未保存的日报？",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("keeps editing and saving available when local storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const api = setup();
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "存储不可用也不应丢失" },
    });
    expect(screen.getByLabelText("完成情况")).toHaveValue(
      "存储不可用也不应丢失",
    );
    expect(screen.getByText(/无法暂存到本机/)).toBeInTheDocument();
    expect(
      screen.queryByText("有未保存的修改（已暂存在本机）"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存日报" }));
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled());
  });
});

describe("report concurrent storage ownership", () => {
  const key = "crm.daily-report-draft.v1.northwind.me.2026-10-22";
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("keeps memory edits and the original version when storage fails and the server advances", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const api = setup({ version: 4 }, client);
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "只有内存中的输入" },
    });
    const initial: Awaited<ReturnType<WorkApi["myReport"]>> = await vi.mocked(
      api.myReport,
    ).mock.results[0].value;
    vi.mocked(api.myReport).mockResolvedValue({
      ...initial,
      report: { ...initial.report!, version: 5, completed: "另一窗口的更新" },
    });
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["workspace", "northwind", "daily-report"],
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("完成情况")).toHaveValue("只有内存中的输入"),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存日报" }));
    await waitFor(() =>
      expect(api.saveReport).toHaveBeenCalledWith(
        "northwind",
        "2026-10-22",
        expect.objectContaining({ version: 4, completed: "只有内存中的输入" }),
      ),
    );
  });

  it("does not remove another tab's newer cache after a successful save", async () => {
    const api = setup({ version: 4 });
    const input = await screen.findByLabelText("完成情况");
    const initial: Awaited<ReturnType<WorkApi["myReport"]>> = await vi.mocked(
      api.myReport,
    ).mock.results[0].value;
    let finish!: (report: NonNullable<typeof initial.report>) => void;
    vi.mocked(api.saveReport).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(input, { target: { value: "窗口A提交内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存日报" }));
    await waitFor(() => expect(api.saveReport).toHaveBeenCalled());
    const other = JSON.stringify({
      sections: {
        plans: "",
        completed: "窗口B尚未保存",
        problems: "",
        nextSteps: "",
      },
      savedAt: "2099-01-01T00:00:00Z",
    });
    window.localStorage.setItem(key, other);
    const report = {
      ...initial.report!,
      completed: "窗口A提交内容",
      version: 5,
    };
    vi.mocked(api.myReport).mockResolvedValue({ ...initial, report });
    await act(async () => finish(report));
    await waitFor(() =>
      expect(screen.getByText("保存日报").closest("button")).toBeDisabled(),
    );
    expect(window.localStorage.getItem(key)).toBe(other);
  });

  it("does not discard a cache another tab changed after this editor wrote", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "本窗口内容" },
    });
    const other = JSON.stringify({
      sections: {
        plans: "",
        completed: "其他窗口的新草稿",
        problems: "",
        nextSteps: "",
      },
      savedAt: "2099-01-01T00:00:00Z",
    });
    window.localStorage.setItem(key, other);
    render(<Link href="/workspace/northwind/other">离开此日报</Link>);
    fireEvent.click(screen.getByText("离开此日报"));
    const modal = await screen.findByRole("dialog", {
      name: "放弃未保存的日报？",
    });
    fireEvent.click(within(modal).getByRole("button", { name: "放弃修改" }));
    expect(window.localStorage.getItem(key)).toBe(other);
  });
});

describe("memory-only report recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  it("guards leaving after reloading a server report when the recovery cannot be persisted", async () => {
    window.localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const api = setup({ version: 4 }, client);
    fireEvent.change(await screen.findByLabelText("完成情况"), {
      target: { value: "仅在页面保留的输入" },
    });
    const initial: Awaited<ReturnType<WorkApi["myReport"]>> = await vi.mocked(
      api.myReport,
    ).mock.results[0].value;
    vi.mocked(api.myReport).mockResolvedValue({
      ...initial,
      report: { ...initial.report!, version: 5, completed: "服务器的新内容" },
    });
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["workspace", "northwind", "daily-report"],
      });
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "载入最新日报" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("完成情况")).toHaveValue("服务器的新内容"),
    );
    render(<Link href="/workspace/northwind/other">离开内存草稿</Link>);
    fireEvent.click(screen.getByText("离开内存草稿"));
    expect(
      await screen.findByRole("dialog", { name: "放弃未保存的日报？" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/仅保留在当前页面/)).toBeInTheDocument();
  });
});
