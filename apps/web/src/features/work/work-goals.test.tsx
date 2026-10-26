import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect, useState, type ReactNode } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { WorkGoalsPanel } from "./work-goals";
import { goalKeys, type GoalRule, type WorkGoalsApi } from "./work-goals-api";

const rule: GoalRule = {
  id: "goal",
  metric: "calls",
  target: 20,
  remindAt: "17:00",
  weekdays: [1, 2, 3, 4, 5],
  audience: "ALL_EMPLOYEES",
  memberIds: [],
  enabled: true,
  version: 7,
};
// Model the router's popstate-driven page unmount while its QueryClient survives.
function HistoryPage({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const navigate = () => setPath(window.location.pathname);
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  return path.endsWith("/team") ? children : null;
}
async function historyGo(direction: "back" | "forward") {
  await act(async () => {
    const navigated = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history[direction]();
    await navigated;
  });
}
function setup(manage = false, history = false) {
  const api: WorkGoalsApi = {
    settings: vi
      .fn()
      .mockResolvedValue({
        timezone: "Asia/Shanghai",
        rules: [rule],
        members: [{ id: "m1", name: "赵晨" }],
      }),
    save: vi
      .fn()
      .mockImplementation(async (_tenant, metric, input) => ({
        ...rule,
        ...input,
        metric,
        version: 8,
      })),
    progress: vi
      .fn()
      .mockResolvedValue({
        timezone: "Asia/Shanghai",
        today: "2026-10-26",
        items: [
          {
            ruleId: "goal",
            metric: "calls",
            memberId: "m1",
            memberName: "赵晨",
            target: 20,
            actual: 8,
            remindAt: "17:00",
            scheduledToday: true,
          },
        ],
      }),
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  const tree = (
    tenantCode = "demo",
    memberId = "admin-1",
    canManage = manage,
  ) => {
    const panel = (
      <WorkGoalsPanel
        tenantCode={tenantCode}
        memberId={memberId}
        manage={canManage}
        api={api}
      />
    );
    return (
      <QueryClientProvider client={client}>
        {history ? <HistoryPage>{panel}</HistoryPage> : panel}
      </QueryClientProvider>
    );
  };
  const view = render(tree());
  return {
    api,
    client,
    ...view,
    mount: () => render(tree()),
    changeIdentity: (tenant: string, member: string, canManage = manage) =>
      view.rerender(tree(tenant, member, canManage)),
  };
}
async function edit() {
  fireEvent.click(await screen.findByRole("button", { name: "配置目标" }));
  await screen.findByLabelText("每日目标值");
}

describe("WorkGoalsPanel", () => {
  it("uses personal scope and shows recorded progress without management controls", async () => {
    const { api } = setup();
    expect(await screen.findByText("还差 12")).toBeInTheDocument();
    expect(screen.getByText("8 / 20")).toBeInTheDocument();
    expect(screen.getByText(/2026-10-26/)).toBeInTheDocument();
    expect(api.progress).toHaveBeenCalledWith("demo", "mine");
    expect(api.settings).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "配置目标" }),
    ).not.toBeInTheDocument();
  });
  it.each([false, true])(
    "isolates fresh progress when accounts change in the same tenant (manage=%s)",
    async (manage) => {
      const { api, client, changeIdentity } = setup(manage);
      await screen.findByText("8 / 20");
      let reject!: (error: Error) => void;
      vi.mocked(api.progress).mockReturnValueOnce(
        new Promise((_resolve, rejectRequest) => {
          reject = rejectRequest;
        }),
      );
      changeIdentity("demo", "member-2");
      expect(screen.queryByText("8 / 20")).not.toBeInTheDocument();
      await waitFor(() => expect(api.progress).toHaveBeenCalledTimes(2));
      await act(async () => reject(new Error("new account offline")));
      await screen.findByText(/目标进度读取失败/);
      expect(screen.queryByText("8 / 20")).not.toBeInTheDocument();
      // Existing task completion invalidates the tenant prefix, including this identity.
      vi.mocked(api.progress).mockResolvedValue({
        timezone: "Asia/Shanghai",
        today: "2026-10-26",
        items: [],
      });
      await act(async () => {
        await client.invalidateQueries({ queryKey: goalKeys.progress("demo") });
      });
      await screen.findByText(
        manage ? "尚未配置启用中的每日目标" : "目前没有分配给你的每日目标",
      );
      expect(api.progress).toHaveBeenCalledTimes(3);
    },
  );
  it("labels unavailable stored recipients without offering them for new selection", async () => {
    const { api } = setup(true);
    vi.mocked(api.settings).mockResolvedValue({
      timezone: "Asia/Shanghai",
      rules: [
        { ...rule, audience: "SELECTED_MEMBERS", memberIds: ["inactive"] },
      ],
      members: [{ id: "m1", name: "赵晨" }],
    });
    await edit();
    expect(
      screen.getByText("已停用或不可用员工（inactive）"),
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择员工" }));
    expect(
      screen.queryByText("已停用或不可用员工（inactive）", {
        selector: ".ant-select-item-option-content",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "启用此目标" }));
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await screen.findByText("目标已保存");
    expect(api.save).toHaveBeenCalledWith(
      "demo",
      "calls",
      expect.objectContaining({ enabled: false, memberIds: ["inactive"] }),
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "选择员工" }), {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
    });
    expect(
      screen.queryByText("已停用或不可用员工（inactive）"),
    ).not.toBeInTheDocument();
  });
  it("saves only the edited metric and sends its observed version", async () => {
    const { api } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("提醒时间"), {
      target: { value: "18:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith("demo", "calls", {
        expectedVersion: 7,
        target: 35,
        remindAt: "18:30",
        weekdays: [1, 2, 3, 4, 5],
        audience: "ALL_EMPLOYEES",
        memberIds: [],
        enabled: true,
      }),
    );
    expect(await screen.findByText("目标已保存")).toBeInTheDocument();
  });
  it("requires recipients when switching to selected employees", async () => {
    const { api } = setup(true);
    await edit();
    fireEvent.click(screen.getByLabelText("指定员工"));
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    expect(await screen.findByText("请选择至少一位员工")).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择员工" }));
    fireEvent.click(
      await screen.findByText("赵晨", {
        selector: ".ant-select-item-option-content",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        "demo",
        "calls",
        expect.objectContaining({
          memberIds: ["m1"],
          audience: "SELECTED_MEMBERS",
        }),
      ),
    );
  });
  it("keeps the edited target after a server version conflict", async () => {
    const { api } = setup(true);
    await edit();
    vi.mocked(api.save).mockRejectedValue({
      code: "RECORD_VERSION_CONFLICT",
      message: "目标已被其他管理员更新，请重新载入后核对",
      requestId: "req-test",
      fieldErrors: {},
      status: 409,
    });
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "55" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await screen.findByText("目标已被其他管理员更新，请重新载入后核对");
    expect(screen.getByLabelText("每日目标值")).toHaveValue("55");
  });
  it("can disable a rule without discarding its configured audience and schedule", async () => {
    const { api } = setup(true);
    await edit();
    fireEvent.click(screen.getByRole("switch", { name: "启用此目标" }));
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        "demo",
        "calls",
        expect.objectContaining({
          target: 20,
          remindAt: "17:00",
          enabled: false,
          expectedVersion: 7,
        }),
      ),
    );
  });
  it("prevents duplicate submissions while saving", async () => {
    const { api } = setup(true);
    await edit();
    vi.mocked(api.save).mockImplementation(() => new Promise(() => {}));
    const button = screen.getByRole("button", { name: "保存目标" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  });
  it("asks before closing a modified configuration", async () => {
    setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭目标配置" }));
    expect(
      await screen.findByText("放弃未保存的目标修改？"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("每日目标值")).toHaveValue("42");
  });
  it("recovers the selected metric, full draft and original version after browser Back/Forward", async () => {
    window.history.replaceState({}, "", "/workspace/demo/work");
    window.history.pushState({}, "", "/workspace/demo/team");
    const { api } = setup(true, true);
    vi.mocked(api.settings).mockResolvedValue({
      timezone: "Asia/Shanghai",
      rules: [rule, { ...rule, metric: "tasksDone", version: 3 }],
      members: [{ id: "m1", name: "赵晨" }],
    });
    await edit();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "工作指标" }));
    fireEvent.click(
      await screen.findByText("完成任务", {
        selector: ".ant-select-item-option-content",
      }),
    );
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("提醒时间"), {
      target: { value: "00:00" },
    });
    fireEvent.click(screen.getByLabelText("周一"));
    fireEvent.click(screen.getByLabelText("指定员工"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择员工" }));
    fireEvent.click(
      await screen.findByText("赵晨", {
        selector: ".ant-select-item-option-content",
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "启用此目标" }));
    await historyGo("back");
    expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
    vi.mocked(api.settings).mockResolvedValue({
      timezone: "Asia/Shanghai",
      rules: [{ ...rule, metric: "tasksDone", target: 90, version: 4 }],
      members: [
        { id: "m1", name: "赵晨（更新）" },
        { id: "m2", name: "孙悦" },
      ],
    });
    await historyGo("forward");
    expect(await screen.findByLabelText("每日目标值")).toHaveValue("42");
    expect(
      screen.getByText(/已恢复本标签页未保存的目标修改/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("提醒时间")).toHaveValue("00:00");
    expect(screen.getByLabelText("周一")).not.toBeChecked();
    expect(screen.getByLabelText("指定员工")).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "启用此目标" }),
    ).not.toBeChecked();
    expect(screen.getByText("赵晨（更新）")).toBeInTheDocument();
    expect(api.settings).toHaveBeenCalledTimes(2);
    vi.mocked(api.save).mockRejectedValue({
      status: 409,
      code: "RECORD_VERSION_CONFLICT",
      requestId: "req-conflict",
      fieldErrors: {},
      message: "目标版本冲突",
    });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await screen.findByText("目标版本冲突");
    expect(api.save).toHaveBeenCalledWith("demo", "tasksDone", {
      expectedVersion: 3,
      target: 42,
      remindAt: "00:00",
      weekdays: [2, 3, 4, 5],
      audience: "SELECTED_MEMBERS",
      memberIds: ["m1"],
      enabled: false,
    });
    expect(screen.getByLabelText("每日目标值")).toHaveValue("42");
  });
  it.each([
    ["other tenant", "elsewhere", "admin-1", true],
    ["other administrator", "demo", "admin-2", true],
    ["employee role", "demo", "admin-1", false],
  ])("isolates recovery from %s", async (_label, tenant, member, manage) => {
    const { changeIdentity } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    changeIdentity(tenant, member, manage);
    expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
    expect(screen.queryByText(/已恢复本标签页/)).not.toBeInTheDocument();
    if (manage) {
      await edit();
      expect(screen.getByLabelText("每日目标值")).toHaveValue("20");
    }
    changeIdentity("demo", "admin-1", true);
    expect(await screen.findByLabelText("每日目标值")).toHaveValue("42");
  });
  it.each(["discard", "save"] as const)(
    "clears recovery on explicit %s",
    async (action) => {
      const { api, unmount, mount } = setup(true);
      await edit();
      fireEvent.change(screen.getByLabelText("每日目标值"), {
        target: { value: "42" },
      });
      unmount();
      const restored = mount();
      expect(await screen.findByLabelText("每日目标值")).toHaveValue("42");
      if (action === "discard") {
        fireEvent.click(screen.getByRole("button", { name: "关闭目标配置" }));
        fireEvent.click(
          await screen.findByRole("button", { name: "放弃修改" }),
        );
      } else {
        fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
        await screen.findByText("目标已保存");
        expect(api.save).toHaveBeenCalledTimes(1);
      }
      restored.unmount();
      mount();
      expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
      expect(screen.queryByText(/已恢复本标签页/)).not.toBeInTheDocument();
      await edit();
      expect(screen.getByLabelText("每日目标值")).toHaveValue("20");
    },
  );
  it("requires a fresh authorized settings response before displaying recovered input", async () => {
    const { api, unmount, mount } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    unmount();
    vi.mocked(api.settings).mockRejectedValue({
      status: 403,
      code: "FORBIDDEN",
      message: "无配置权限",
      requestId: "req-forbidden",
      fieldErrors: {},
    });
    mount();
    await screen.findByText("无配置权限");
    expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });
  it("clears recovery when a save succeeds after the editor has unmounted", async () => {
    const { api, unmount, mount } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    let finish!: (value: GoalRule) => void;
    vi.mocked(api.save).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    unmount();
    await act(async () => {
      finish({ ...rule, target: 42, version: 8 });
    });
    mount();
    expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
    expect(screen.queryByText(/已恢复本标签页/)).not.toBeInTheDocument();
  });
  it("keeps newer recovered edits when an earlier unmounted save finishes", async () => {
    const { api, unmount, mount } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    let finish!: (value: GoalRule) => void;
    vi.mocked(api.save).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    unmount();
    const restored = mount();
    fireEvent.change(await screen.findByLabelText("每日目标值"), {
      target: { value: "55" },
    });
    await act(async () => {
      finish({ ...rule, target: 42, version: 8 });
    });
    restored.unmount();
    mount();
    expect(await screen.findByLabelText("每日目标值")).toHaveValue("55");
  });
  it("clears recovery after confirming a guarded link departure", async () => {
    const { unmount, mount } = setup(true);
    await edit();
    fireEvent.change(screen.getByLabelText("每日目标值"), {
      target: { value: "42" },
    });
    const anchor = document.createElement("a");
    anchor.href = "/workspace/demo/other";
    document.body.append(anchor);
    fireEvent.click(anchor);
    anchor.remove();
    fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
    unmount();
    mount();
    expect(screen.queryByLabelText("每日目标值")).not.toBeInTheDocument();
    expect(screen.queryByText(/已恢复本标签页/)).not.toBeInTheDocument();
  });
  it("refresh failure does not resubmit a successfully saved rule", async () => {
    const { api } = setup(true);
    await edit();
    vi.mocked(api.progress).mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
    await screen.findByText("目标已保存");
    expect(await screen.findByText(/目标进度读取失败/)).toBeInTheDocument();
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});
