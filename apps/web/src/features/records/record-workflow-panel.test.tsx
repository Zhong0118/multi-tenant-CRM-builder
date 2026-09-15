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
          { key: "mark-won", label: "标记赢单", requiredFieldKeys: ["amount"] },
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
          { key: "mark-won", label: "标记赢单", requiredFieldKeys: ["amount"] },
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
});
