import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ObjectDraft } from "./object-types";
import { WorkflowDesigner } from "./workflow-designer";
import type { WorkflowApi } from "./workflow-api";
import type { WorkflowDraft } from "./workflow-types";

function objectDraft(): ObjectDraft {
  return {
    object: {
      id: "object-1",
      code: "customers",
      name: "客户资料",
      description: null,
      titleFieldKey: "customer_name",
      icon: null,
      sortOrder: 10,
      version: 4,
      status: "ACTIVE",
      publicationNumber: 3,
      publishedAt: "2026-08-20T00:00:00.000Z",
      hasUnpublishedChanges: false,
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    fields: [
      {
        id: "field-amount",
        fieldKey: "amount",
        label: "预计金额",
        type: "MONEY",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
        status: "ACTIVE",
        publishedType: "MONEY",
        employeeAccess: "EDIT",
      },
    ],
    defaultView: null,
    employeeAccess: null,
    activeRecordCount: 0,
  } as ObjectDraft;
}

function emptyWorkflow(): WorkflowDraft {
  return {
    isEnabled: false,
    initialStateKey: null,
    states: [],
    transitions: [],
    objectVersion: 4,
  };
}

function renderDesigner(api: WorkflowApi) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowDesigner
        tenantCode="northwind"
        draft={objectDraft()}
        onObjectVersion={vi.fn()}
        api={api}
      />
    </QueryClientProvider>,
  );
}

describe("WorkflowDesigner", () => {
  it("saves added states, an initial state and a transition", async () => {
    const saveDraft = vi.fn(async (_tenant: string, _id: string, input) => ({
      ...input,
      objectVersion: 5,
    }));
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft,
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    renderDesigner(api);

    fireEvent.click(await screen.findByRole("button", { name: "添加状态" }));
    fireEvent.click(screen.getByRole("button", { name: "添加状态" }));
    fireEvent.change(screen.getByLabelText("状态名称 1"), {
      target: { value: "新建" },
    });
    fireEvent.change(screen.getByLabelText("状态编码 1"), {
      target: { value: "new" },
    });
    fireEvent.change(screen.getByLabelText("状态名称 2"), {
      target: { value: "赢单" },
    });
    fireEvent.change(screen.getByLabelText("状态编码 2"), {
      target: { value: "won" },
    });
    fireEvent.click(screen.getAllByText("初始")[0]);
    fireEvent.click(screen.getByRole("button", { name: "添加动作" }));
    fireEvent.change(screen.getByLabelText("动作名称 1"), {
      target: { value: "标记赢单" },
    });
    fireEvent.change(screen.getByLabelText("动作编码 1"), {
      target: { value: "mark-won" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls[0][2]).toMatchObject({
      expectedDraftRevision: 4,
      states: [
        expect.objectContaining({ key: "new", label: "新建" }),
        expect.objectContaining({ key: "won", label: "赢单" }),
      ],
      transitions: [
        expect.objectContaining({ key: "mark-won", label: "标记赢单" }),
      ],
    });
    expect(await screen.findByText("流程配置已保存")).toBeInTheDocument();
  });
});
