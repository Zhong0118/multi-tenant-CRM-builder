import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowApi } from "@/features/objects/workflow-api";
import { RecordWorkflowPanel } from "./record-workflow-panel";

function renderPanel(api: WorkflowApi) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecordWorkflowPanel
        tenantCode="northwind"
        objectCode="leads"
        recordId="record-1"
        recordVersion={7}
        api={api}
      />
    </QueryClientProvider>,
  );
}

describe("RecordWorkflowPanel", () => {
  it("shows employee transitions and executes one", async () => {
    const executeTransition = vi.fn().mockResolvedValue({
      currentState: { key: "won", label: "赢单", isTerminal: true },
      availableTransitions: [],
      recordVersion: 8,
    });
    const api: WorkflowApi = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "new", label: "新建", isTerminal: false },
        availableTransitions: [
          {
            key: "mark-won",
            label: "标记赢单",
            requiredFieldKeys: ["amount"],
            effects: [],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition,
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    };
    renderPanel(api);
    fireEvent.click(await screen.findByRole("button", { name: "标记赢单" }));
    await waitFor(() =>
      expect(executeTransition).toHaveBeenCalledWith(
        "northwind",
        "leads",
        "record-1",
        "mark-won",
        7,
      ),
    );
    expect(await screen.findByText("赢单")).toBeInTheDocument();
  });

  it("hides action buttons when none are available", async () => {
    const api: WorkflowApi = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "new", label: "新建", isTerminal: false },
        availableTransitions: [],
        recordVersion: 7,
      }),
      executeTransition: vi.fn(),
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    };
    renderPanel(api);
    expect(await screen.findByText("新建")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "标记赢单" })).toBeNull();
  });

  it("shows a required-field error from the API", async () => {
    const api: WorkflowApi = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "new", label: "新建", isTerminal: false },
        availableTransitions: [
          {
            key: "mark-won",
            label: "标记赢单",
            requiredFieldKeys: ["amount"],
            effects: [],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition: vi.fn().mockRejectedValue({
        code: "WORKFLOW_REQUIRED_FIELDS_MISSING",
        message: "“标记赢单”前需要补充：预计金额",
        fieldErrors: { amount: ["请填写必填字段。"] },
        requestId: "req-1",
        status: 400,
      }),
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    };
    renderPanel(api);
    fireEvent.click(await screen.findByRole("button", { name: "标记赢单" }));
    expect(
      await screen.findByText("“标记赢单”前需要补充：预计金额"),
    ).toBeInTheDocument();
  });

  it("confirms the static effects of a transition with actions (§31)", async () => {
    const executeTransition = vi.fn();
    const api = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "lead", label: "线索", isTerminal: false },
        availableTransitions: [
          {
            key: "convert",
            label: "转化",
            requiredFieldKeys: [],
            effects: [
              { type: "CREATE_RECORD", label: "创建 1 条记录" },
              { type: "CREATE_FOLLOW_UP", label: "创建 1 个待跟进事项" },
            ],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition,
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    } satisfies WorkflowApi;
    renderPanel(api);

    fireEvent.click(await screen.findByText(/转\s*化/));

    // The summary is what the server sent, in execution order, verbatim.
    expect(await screen.findByText("创建 1 条记录")).toBeInTheDocument();
    expect(screen.getByText("创建 1 个待跟进事项")).toBeInTheDocument();
    expect(
      screen.getByText("所有操作将同时成功或全部取消。"),
    ).toBeInTheDocument();
    // Opening the confirmation is not an execution.
    expect(executeTransition).not.toHaveBeenCalled();
  });

  it("executes only after the confirmation is accepted", async () => {
    const executeTransition = vi.fn().mockResolvedValue({
      currentState: { key: "customer", label: "客户", isTerminal: false },
      availableTransitions: [],
      recordVersion: 8,
    });
    const api = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "lead", label: "线索", isTerminal: false },
        availableTransitions: [
          {
            key: "convert",
            label: "转化",
            requiredFieldKeys: [],
            effects: [{ type: "CREATE_RECORD", label: "创建 1 条记录" }],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition,
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    } satisfies WorkflowApi;
    renderPanel(api);

    fireEvent.click(await screen.findByText(/转\s*化/));
    fireEvent.click(await screen.findByText("确认执行"));

    await waitFor(() =>
      expect(executeTransition).toHaveBeenCalledWith(
        "northwind",
        "leads",
        "record-1",
        "convert",
        7,
      ),
    );
    expect(await screen.findByText("客户")).toBeInTheDocument();
  });

  it("makes no API call when the confirmation is cancelled", async () => {
    const executeTransition = vi.fn();
    const api = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "lead", label: "线索", isTerminal: false },
        availableTransitions: [
          {
            key: "convert",
            label: "转化",
            requiredFieldKeys: [],
            effects: [{ type: "CREATE_RECORD", label: "创建 1 条记录" }],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition,
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    } satisfies WorkflowApi;
    renderPanel(api);

    fireEvent.click(await screen.findByText(/转\s*化/));
    expect(await screen.findByText("创建 1 条记录")).toBeInTheDocument();
    // antd inserts a space between two CJK characters, and the all-or-nothing
    // copy below also contains “取消”, so the button is matched exactly.
    fireEvent.click(screen.getByText("取 消"));

    // Cancelling is not an execution: no request is made at all. (The dialog
    // itself stays mounted under jsdom because rc-motion's leave transition
    // never ends, so element removal is not assertable — same as the other
    // Modal tests in this app.)
    await waitFor(() => expect(executeTransition).not.toHaveBeenCalled());
  });

  it("executes a transition without actions directly, with no modal", async () => {
    const executeTransition = vi.fn().mockResolvedValue({
      currentState: { key: "won", label: "赢单", isTerminal: true },
      availableTransitions: [],
      recordVersion: 8,
    });
    const api = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "new", label: "新建", isTerminal: false },
        availableTransitions: [
          {
            key: "mark-won",
            label: "标记赢单",
            requiredFieldKeys: [],
            effects: [],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition,
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    } satisfies WorkflowApi;
    renderPanel(api);

    fireEvent.click(await screen.findByText("标记赢单"));

    await waitFor(() =>
      expect(executeTransition).toHaveBeenCalledWith(
        "northwind",
        "leads",
        "record-1",
        "mark-won",
        7,
      ),
    );
    expect(screen.queryByText("确认执行")).toBeNull();
    expect(screen.queryByText("所有操作将同时成功或全部取消。")).toBeNull();
  });

  it("shows the failed action's step and field detail (§32)", async () => {
    const api = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue({
        currentState: { key: "lead", label: "线索", isTerminal: false },
        availableTransitions: [
          {
            key: "convert",
            label: "转化",
            requiredFieldKeys: [],
            effects: [{ type: "CREATE_RECORD", label: "创建 1 条记录" }],
          },
        ],
        recordVersion: 7,
      }),
      executeTransition: vi.fn().mockRejectedValue({
        code: "ACTION_EXECUTION_FAILED",
        message:
          "无法完成“convert”：步骤“create-customer”失败。所有变更均未保存。",
        fieldErrors: {
          "actions.create-customer.phone": ["手机号格式不正确。"],
        },
        requestId: "req-9",
        status: 400,
      }),
      history: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      }),
    } satisfies WorkflowApi;
    renderPanel(api);

    fireEvent.click(await screen.findByText(/转\s*化/));
    fireEvent.click(await screen.findByText("确认执行"));

    // The server's own message, not a generic "操作失败".
    expect(
      await screen.findByText(
        "无法完成“convert”：步骤“create-customer”失败。所有变更均未保存。",
      ),
    ).toBeInTheDocument();
    // …and the reason the step failed, which only the field errors carry.
    expect(screen.getByText("手机号格式不正确。")).toBeInTheDocument();
  });
});
