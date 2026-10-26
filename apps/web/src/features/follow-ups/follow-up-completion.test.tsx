import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { FollowUpPanel } from "./follow-up-panel";
import { PersonalFollowUpWorkbench } from "./follow-up-workbench";
import {
  followUpQueryKeys,
  type followUpApi,
  type FollowUp,
} from "./follow-up-api";
import type { WorkApi } from "@/features/work/work-api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/northwind",
  useSearchParams: () => new URLSearchParams(),
}));

const task: FollowUp = {
  id: "task-1",
  recordId: "record-1",
  recordTitle: "客户 A",
  objectCode: "customers",
  objectName: "客户",
  title: "确认客户反馈",
  dueAt: "2026-10-28T00:00:00Z",
  status: "OPEN",
  version: 3,
  overdue: false,
  canManage: true,
};
const result = {
  activityId: "activity-1",
  activityType: "MESSAGE" as const,
  content: "已发资料，等待客户回复",
  outcome: "NOT_REACHED" as const,
  actorDisplayName: "王同事",
  completedAt: "2026-10-26T03:00:00Z",
};

function setup(
  entry: "panel" | "workbench",
  items = [task],
  onCompleted?: () => Promise<void>,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const api = {
    recipients: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi
      .fn<typeof followUpApi.update>()
      .mockResolvedValue({ ...task, status: "DONE", completionResult: result }),
    list: vi.fn<typeof followUpApi.list>(async () => ({
      items,
      total: items.length,
      page: 1,
      limit: 20,
      openCount: items.length,
      overdueCount: 0,
    })),
    workbench: vi.fn(async () => ({
      timezone: "Asia/Shanghai",
      counts: { allOpen: 1, overdue: 0, today: 1, upcoming: 0 },
      pendingContacts: { count: 0, items: [] },
      preview: { overdue: [], today: [task], upcoming: [] },
    })),
  } satisfies typeof followUpApi;
  const keys = [
    [...followUpQueryKeys.root("northwind"), "inactive"],
    [
      "workspace",
      "northwind",
      "objects",
      "customers",
      "records",
      "record-1",
      "activities",
    ],
    ["workspace", "northwind", "records", "customers"],
  ];
  for (const key of keys) {
    client.setQueryDefaults(key, {
      queryFn: async () => ({ refreshed: true }),
    });
    client.setQueryData(key, { old: true });
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={client}>
        {entry === "panel" ? (
          <FollowUpPanel
            tenantCode="northwind"
            api={api}
            onCompleted={onCompleted}
          />
        ) : (
          <PersonalFollowUpWorkbench
            tenantCode="northwind"
            api={api}
            work={
              {
                listTasks: async () => ({
                  items: [],
                  total: 0,
                  page: 1,
                  limit: 100,
                }),
              } as unknown as WorkApi
            }
          />
        )}
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { api, client, keys };
}

async function open() {
  fireEvent.click(await screen.findByRole("button", { name: /^完\s*成$/ }));
  return screen.findByRole("dialog", { name: "完成跟进" });
}

async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(
    await screen.findByText(option, {
      selector: ".ant-select-item-option-content",
    }),
  );
}

describe.each(["panel", "workbench"] as const)(
  "%s follow-up completion",
  (entry) => {
    it("requires meaningful content and does not mutate when dismissed", async () => {
      const { api } = setup(entry);
      const dialog = await open();
      expect(within(dialog).getByText("确认客户反馈")).toBeInTheDocument();
      const submit = within(dialog).getByRole("button", { name: "保存并完成" });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText("完成结果"), {
        target: { value: "  \n  " },
      });
      expect(submit).toBeDisabled();
      fireEvent.click(
        within(dialog).getByRole("button", { name: /^取\s*消$/ }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(api.update).not.toHaveBeenCalled();
    });

    it("retains a failed draft and only closes after a successful retry refresh", async () => {
      const { api, client, keys } = setup(entry);
      api.update.mockRejectedValueOnce(new Error("network unavailable"));
      await open();
      fireEvent.change(screen.getByLabelText("完成结果"), {
        target: { value: "  已发资料，等待客户回复  " },
      });
      await choose("活动类型", "微信/消息");
      await choose("沟通结果", "未回复");
      fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("完成结果")).toHaveValue(
        "  已发资料，等待客户回复  ",
      );
      expect(screen.getByRole("dialog")).toHaveTextContent("未回复");
      fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(api.update).toHaveBeenCalledTimes(2);
      expect(api.update).toHaveBeenLastCalledWith("northwind", "task-1", {
        version: 3,
        status: "DONE",
        completionResult: {
          activityType: "MESSAGE",
          content: "已发资料，等待客户回复",
          outcome: "NOT_REACHED",
        },
      });
      for (const key of keys)
        expect(client.getQueryData(key)).toEqual({ refreshed: true });
    });
  },
);

const conflict = {
  code: "RECORD_VERSION_CONFLICT",
  status: 409,
  message: "记录已更新，请刷新",
  requestId: "req_conflict",
  fieldErrors: {},
};

it.each(["panel", "workbench"] as const)(
  "%s recovers a committed completion whose response was lost, including later DONE pages",
  async (entry) => {
    const { api } = setup(entry);
    let saved: FollowUp = task;
    let activityCount = 0;
    api.update.mockImplementation(async (_tenant, _id, input) => {
      if (saved.version !== input.version) throw conflict;
      activityCount++;
      saved = {
        ...task,
        version: 4,
        status: "DONE",
        completionResult: {
          ...result,
          activityType: "NOTE",
          content: input.completionResult!.content,
          outcome: null,
        },
      };
      throw new Error("response lost after commit");
    });
    api.list.mockImplementation(async (_tenant, query) => {
      const all =
        query.status === "DONE"
          ? [
              ...Array.from({ length: 50 }, (_, i) => ({
                ...saved,
                id: `older-${i}`,
                title: `历史事项 ${i}`,
                completionResult: { ...result, content: `历史内容 ${i}` },
              })),
              saved,
            ]
          : saved.status === "OPEN"
            ? [task]
            : [];
      const limit = query.limit ?? 20;
      const offset = ((query.page ?? 1) - 1) * limit;
      return {
        items: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        page: query.page ?? 1,
        openCount: saved.status === "OPEN" ? 1 : 0,
        overdueCount: 0,
      };
    });
    api.workbench.mockImplementation(async () => ({
      timezone: "Asia/Shanghai",
      counts: {
        allOpen: saved.status === "OPEN" ? 1 : 0,
        overdue: 0,
        today: 0,
        upcoming: 0,
      },
      pendingContacts: { count: 0, items: [] },
      preview: {
        overdue: [],
        today: saved.status === "OPEN" ? [task] : [],
        upcoming: [],
      },
    }));
    await open();
    fireEvent.change(screen.getByLabelText("完成结果"), {
      target: { value: "  实际已保存的结果  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("完成结果")).toHaveValue(
      "  实际已保存的结果  ",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(activityCount).toBe(1);
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledWith("northwind", {
      recordId: "record-1",
      status: "DONE",
      page: 2,
      limit: 50,
    });
    if (entry === "panel") {
      expect(
        screen.queryByRole("button", { name: /^完\s*成$/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: "已完成" }));
      fireEvent.click(await screen.findByTitle("3"));
      const displayed = await screen.findByText("实际已保存的结果");
      expect(displayed.closest("li")).toHaveTextContent("王同事");
    } else
      expect(screen.getByTestId("workbench-count-all")).toHaveTextContent("0");
  },
);

it.each([
  "different-result",
  "newer-version",
  "cancelled",
  "forbidden",
] as const)(
  "preserves the draft and only retries reads for a %s conflict",
  async (scenario) => {
    const { api } = setup("panel");
    api.update.mockRejectedValue(conflict);
    api.list.mockImplementation(async (_tenant, query) => {
      if (query.status !== "DONE")
        return {
          items: [task],
          total: 1,
          page: 1,
          limit: 20,
          openCount: 1,
          overdueCount: 0,
        };
      if (scenario === "forbidden")
        throw {
          ...conflict,
          status: 403,
          code: "OBJECT_ACTION_FORBIDDEN",
          message: "无权读取跟进",
        };
      const completed = {
        ...task,
        status: "DONE",
        version: scenario === "newer-version" ? 5 : 4,
        completionResult: {
          ...result,
          activityType: "NOTE" as const,
          content:
            scenario === "different-result" ? "其他人保存的结果" : "我的草稿",
          outcome: null,
        },
      };
      return {
        items: scenario === "cancelled" ? [] : [completed],
        total: scenario === "cancelled" ? 0 : 1,
        page: 1,
        limit: 50,
        openCount: 0,
        overdueCount: 0,
      };
    });
    await open();
    fireEvent.change(screen.getByLabelText("完成结果"), {
      target: { value: "我的草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("跟进已完成，结果已保存");
    expect(screen.getByLabelText("完成结果")).toHaveValue("我的草稿");
    expect(screen.getByLabelText("完成结果")).toBeEnabled();
    const reads = api.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() =>
      expect(api.list.mock.calls.length).toBeGreaterThan(reads),
    );
    expect(api.update).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("dialog", { name: "完成跟进" }),
    ).toBeInTheDocument();
  },
);

it("confirms discarding a meaningful result and keeps it when continuing", async () => {
  const { api } = setup("panel");
  const dialog = await open();
  fireEvent.change(screen.getByLabelText("完成结果"), {
    target: { value: "待保存的结果" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: /^取\s*消$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("完成结果")).toHaveValue("待保存的结果");
  fireEvent.click(within(dialog).getByRole("button", { name: /^取\s*消$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.update).not.toHaveBeenCalled();
});

it("clears an incompatible outcome when changing the activity type", async () => {
  const { api } = setup("panel");
  await open();
  fireEvent.change(screen.getByLabelText("完成结果"), {
    target: { value: "补充背景" },
  });
  await choose("活动类型", "微信/消息");
  await choose("沟通结果", "新加上微信");
  await choose("活动类型", "备注");
  expect(screen.queryByLabelText("沟通结果")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
      version: 3,
      status: "DONE",
      completionResult: { activityType: "NOTE", content: "补充背景" },
    }),
  );
});

it("waits for detail refresh while preventing duplicate submissions and dismissal", async () => {
  let release!: () => void;
  const onCompleted = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const { api } = setup("panel", [task], onCompleted);
  const dialog = await open();
  fireEvent.change(screen.getByLabelText("完成结果"), {
    target: { value: "已确认反馈" },
  });
  const submit = screen.getByRole("button", { name: "保存并完成" });
  fireEvent.click(submit);
  await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
  expect(
    within(dialog).getByRole("button", { name: /^关\s*闭$/ }),
  ).toBeDisabled();
  fireEvent.click(submit);
  expect(api.update).toHaveBeenCalledOnce();
  expect(dialog).toBeInTheDocument();
  await act(async () => {
    release();
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("shows the persisted result and leaves legacy completed tasks without invented content", async () => {
  setup("panel", [
    { ...task, status: "DONE", completionResult: result },
    {
      ...task,
      id: "legacy",
      title: "历史跟进",
      status: "DONE",
      completionResult: null,
    },
  ]);
  const content = await screen.findByText("已发资料，等待客户回复");
  expect(content.closest("li")).toHaveTextContent("微信/消息");
  expect(content.closest("li")).toHaveTextContent("未回复");
  expect(content.closest("li")).toHaveTextContent("王同事");
  expect(
    content
      .closest("li")
      ?.querySelector('time[datetime="2026-10-26T03:00:00Z"]'),
  ).toBeInTheDocument();
  expect(screen.getByText("历史跟进").closest("li")).not.toHaveTextContent(
    "完成结果",
  );
  expect(
    screen.queryByRole("button", { name: /^完\s*成$/ }),
  ).not.toBeInTheDocument();
});

it("retries only refresh after a saved result and never resubmits the activity", async () => {
  const onCompleted = vi
    .fn()
    .mockRejectedValueOnce(new Error("detail unavailable"))
    .mockResolvedValue(undefined);
  const { api } = setup("panel", [task], onCompleted);
  await open();
  fireEvent.change(screen.getByLabelText("完成结果"), {
    target: { value: "已确认反馈" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并完成" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "跟进已完成，结果已保存",
  );
  expect(screen.getByLabelText("完成结果")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.update).toHaveBeenCalledOnce();
  expect(onCompleted).toHaveBeenCalledTimes(2);
});

it("rejects content beyond the activity limit but accepts exactly 4000 characters", async () => {
  const { api } = setup("panel");
  await open();
  const content = screen.getByLabelText("完成结果");
  const submit = screen.getByRole("button", { name: "保存并完成" });
  fireEvent.change(content, { target: { value: "字".repeat(4001) } });
  expect(submit).toBeDisabled();
  expect(api.update).not.toHaveBeenCalled();
  fireEvent.change(content, { target: { value: "字".repeat(4000) } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
    version: 3,
    status: "DONE",
    completionResult: { activityType: "NOTE", content: "字".repeat(4000) },
  });
});
