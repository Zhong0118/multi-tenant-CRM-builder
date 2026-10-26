import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { WorkGoalsPanel } from "./work-goals";
import type { GoalRule, WorkGoalsApi } from "./work-goals-api";

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
function setup(manage = false) {
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkGoalsPanel tenantCode="demo" manage={manage} api={api} />
    </QueryClientProvider>,
  );
  return { api, client, ...view };
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
      code: "CONFIG_VERSION_CONFLICT",
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
