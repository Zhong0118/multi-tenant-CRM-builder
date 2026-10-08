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

import type { ObjectApi } from "./object-api";
import type { ObjectDraft } from "./object-types";
import { WorkflowDesigner } from "./workflow-designer";
import type { WorkflowApi } from "./workflow-api";
import type { WorkflowDraft } from "./workflow-types";

function dropdownFor(label: string): Element | null {
  const combobox = screen.getByLabelText(label);
  const listId = combobox.getAttribute("aria-controls");
  const list = listId === null ? null : document.getElementById(listId);
  return list?.closest(".ant-select-dropdown") ?? null;
}

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
        id: "field-name",
        fieldKey: "customer_name",
        label: "公司名称",
        type: "TEXT",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
        status: "ACTIVE",
        publishedType: "TEXT",
        employeeAccess: "EDIT",
      },
      {
        id: "field-amount",
        fieldKey: "amount",
        label: "预计金额",
        type: "MONEY",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 2,
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

/** The Target Object the CREATE_RECORD editor reads its fields from. */
function targetDraft(): ObjectDraft {
  return {
    object: {
      id: "object-2",
      code: "customer",
      name: "客户",
      description: null,
      titleFieldKey: "name",
      icon: null,
      sortOrder: 20,
      version: 2,
      status: "ACTIVE",
      publicationNumber: 1,
      publishedAt: "2026-08-20T00:00:00.000Z",
      hasUnpublishedChanges: false,
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    fields: [
      {
        id: "field-name",
        fieldKey: "name",
        label: "客户名称",
        type: "TEXT",
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
        status: "ACTIVE",
        publishedType: "TEXT",
        employeeAccess: "EDIT",
      },
    ],
    defaultView: null,
    employeeAccess: null,
    activeRecordCount: 0,
  } as ObjectDraft;
}

/**
 * The designer reads Target Object field metadata from the EXISTING admin
 * object list endpoint (`objectApi.listDrafts`); no new API is introduced.
 */
function objectApi(overrides: Partial<ObjectApi> = {}): ObjectApi {
  return {
    listAccessible: vi.fn(),
    runtimeSchema: vi.fn(),
    listDrafts: vi.fn().mockResolvedValue([objectDraft(), targetDraft()]),
    draft: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    reorderObjects: vi.fn(),
    createField: vi.fn(),
    updateField: vi.fn(),
    reorderFields: vi.fn(),
    updateDefaultView: vi.fn(),
    updatePermissions: vi.fn(),
    analyzePublication: vi.fn(),
    publish: vi.fn(),
    listPublications: vi.fn(),
    archive: vi.fn(),
    removeDraft: vi.fn(),
    ...overrides,
  };
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

function renderDesigner(
  api: WorkflowApi,
  objects: ObjectApi = objectApi(),
  onObjectVersion = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <WorkflowDesigner
        tenantCode="northwind"
        draft={objectDraft()}
        onObjectVersion={onObjectVersion}
        api={api}
        objectApi={objects}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

/**
 * A closed dropdown stays mounted in jsdom, so the dropdown is read through the
 * `aria-controls` listbox the open combobox points at. The Target Object list
 * arrives from a query, so the option is awaited.
 */
async function pick(label: string, option: string) {
  await waitFor(() => {
    const combobox = screen.getByLabelText(label);
    fireEvent.mouseDown(combobox);
    const listId = combobox.getAttribute("aria-controls");
    const list = listId === null ? null : document.getElementById(listId);
    const item = list
      ?.closest(".ant-select-dropdown")
      ?.querySelector(`.ant-select-item-option[title="${option}"]`);
    if (!item) throw new Error(`「${label}」没有可选项「${option}」`);
    fireEvent.click(item);
  });
}

/** The options one select currently offers, read through its own listbox. */
function openOptions(label: string): string[] {
  const combobox = screen.getByLabelText(label);
  fireEvent.mouseDown(combobox);
  const listId = combobox.getAttribute("aria-controls");
  const list = listId === null ? null : document.getElementById(listId);
  return Array.from(
    list
      ?.closest(".ant-select-dropdown")
      ?.querySelectorAll(".ant-select-item-option") ?? [],
  ).map((option) => option.getAttribute("title") ?? "");
}

describe("WorkflowDesigner", () => {
  it("groups states and executable transitions with visible controls and draft effects", async () => {
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft: vi.fn(),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    renderDesigner(api);
    const states = await screen.findByRole("region", { name: "状态" });
    const transitions = screen.getByRole("region", { name: "可执行动作" });
    fireEvent.click(within(states).getByRole("button", { name: "添加状态" }));
    fireEvent.click(
      within(transitions).getByRole("button", { name: "添加动作" }),
    );
    expect(screen.getByRole("switch", { name: "启用流程" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      within(states).getByRole("switch", { name: "初始状态 1" }),
    ).toBeInTheDocument();
    expect(
      within(states).getByRole("switch", { name: "终止状态 1" }),
    ).toBeInTheDocument();
    for (const label of ["状态名称", "状态编码", "初始状态", "终止状态"]) {
      expect(within(states).getByText(label)).toBeVisible();
    }
    for (const label of [
      "动作名称",
      "动作编码",
      "从状态",
      "到状态",
      "允许角色",
      "必填字段",
    ]) {
      expect(within(transitions).getByText(label)).toBeVisible();
    }
    expect(
      within(transitions).getByRole("region", { name: "执行动作 1" }),
    ).toBeInTheDocument();
    expect(screen.getByText("当前编辑：客户资料 · 流程草稿")).toBeVisible();
    expect(
      screen.getByText(
        "保存仅更新流程草稿；发布业务表后，员工才会使用新的状态、可执行动作和执行步骤。",
      ),
    ).toBeVisible();
  });
  it("keeps local input after a conflict and a background draft refetch", async () => {
    const getDraft = vi.fn().mockResolvedValue(emptyWorkflow());
    const api: WorkflowApi = {
      getDraft,
      saveDraft: vi
        .fn()
        .mockRejectedValue({
          code: "VERSION_CONFLICT",
          message: "草稿版本已更新",
          requestId: "req-conflict",
          status: 409,
          fieldErrors: {},
        }),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    const { client } = renderDesigner(api);
    fireEvent.click(await screen.findByRole("button", { name: "添加状态" }));
    fireEvent.change(screen.getByLabelText("状态名称 1"), {
      target: { value: "本地草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));
    await screen.findByText(/草稿版本已更新.*req-conflict/);
    getDraft.mockResolvedValue({
      ...emptyWorkflow(),
      states: [
        {
          key: "server",
          label: "服务器状态",
          sortOrder: 10,
          isTerminal: false,
        },
      ],
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["workspace", "northwind", "workflow-draft", "object-1"],
      });
      // Query observer notifications are scheduled after the fetch promise.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(getDraft).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("状态名称 1")).toHaveValue("本地草稿");
  });

  it("does not lose input while a deferred save is pending", async () => {
    let resolveSave!: (saved: WorkflowDraft) => void;
    const pending = new Promise<WorkflowDraft>((resolve) => {
      resolveSave = resolve;
    });
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft: vi.fn(() => pending),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    const onObjectVersion = vi.fn();
    renderDesigner(api, objectApi(), onObjectVersion);
    fireEvent.click(await screen.findByRole("button", { name: "添加状态" }));
    fireEvent.change(screen.getByLabelText("状态名称 1"), {
      target: { value: "保存的状态" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加动作" }));
    fireEvent.click(screen.getByRole("button", { name: "添加执行动作" }));
    await pick("目标业务表 1-1", "客户");
    await pick("添加字段映射 1-1", "客户名称");
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));
    const input = screen.getByLabelText("状态名称 1") as HTMLInputElement;
    expect(input).toBeDisabled();
    const submitted = vi.mocked(api.saveDraft).mock.calls[0][2];
    await act(async () => {
      resolveSave({ ...submitted, objectVersion: 5 });
    });
    await screen.findByText("流程配置已保存");
    expect(screen.getByLabelText("状态名称 1")).toHaveValue("保存的状态");
    expect(onObjectVersion).toHaveBeenCalledWith({
      ...objectDraft(),
      object: { ...objectDraft().object, version: 5 },
    });
  });

  it("does not add a mapping from the portal while a deferred save is pending", async () => {
    let resolveSave!: (saved: WorkflowDraft) => void;
    const pending = new Promise<WorkflowDraft>((resolve) => {
      resolveSave = resolve;
    });
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft: vi.fn(() => pending),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    renderDesigner(api, objectApi(), vi.fn());
    fireEvent.click(await screen.findByRole("button", { name: "添加状态" }));
    fireEvent.click(screen.getByRole("button", { name: "添加动作" }));
    fireEvent.click(screen.getByRole("button", { name: "添加执行动作" }));
    await pick("目标业务表 1-1", "客户");
    fireEvent.click(screen.getByRole("button", { name: "保存流程" }));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1));

    const mapping = screen.getByLabelText("添加字段映射 1-1");
    fireEvent.mouseDown(mapping.closest(".ant-select")!);
    fireEvent.mouseDown(mapping);
    const dropdown = dropdownFor("添加字段映射 1-1");
    const customerName = dropdown?.querySelector('[title="客户名称"]');
    if (customerName) fireEvent.click(customerName);
    expect(mapping).toBeDisabled();
    expect(screen.queryByLabelText("映射目标字段 1-1-1")).not.toBeInTheDocument();

    const submitted = vi.mocked(api.saveDraft).mock.calls[0][2];
    await act(async () => {
      resolveSave({ ...submitted, objectVersion: 5 });
    });
    await screen.findByText("流程配置已保存");
  });

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
    const onObjectVersion = vi.fn();
    renderDesigner(api, objectApi(), onObjectVersion);

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
    expect(onObjectVersion).toHaveBeenCalledWith({
      ...objectDraft(),
      object: { ...objectDraft().object, version: 5 },
    });
  });

  it("starts a new transition with no actions and saves the configured steps in order", async () => {
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

    fireEvent.click(await screen.findByText("添加动作"));
    fireEvent.change(screen.getByLabelText("动作名称 1"), {
      target: { value: "赢单后建客户" },
    });
    fireEvent.change(screen.getByLabelText("动作编码 1"), {
      target: { value: "mark-won" },
    });

    // A brand new transition carries an explicit empty step list.
    fireEvent.click(screen.getByText("添加执行动作"));
    expect(screen.getByText("步骤 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("执行动作编码 1-1"), {
      target: { value: "create-customer" },
    });
    await pick("目标业务表 1-1", "客户");
    await pick("添加字段映射 1-1", "客户名称");

    fireEvent.click(screen.getByText("保存流程"));

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls[0][2]).toMatchObject({
      transitions: [
        expect.objectContaining({
          key: "mark-won",
          actions: [
            {
              key: "create-customer",
              type: "CREATE_RECORD",
              targetObjectCode: "customer",
              values: {
                name: { source: "SOURCE_FIELD", fieldKey: "customer_name" },
              },
            },
          ],
        }),
      ],
    });
  });

  it("saves a transition with no actions as an empty list", async () => {
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

    fireEvent.click(await screen.findByText("添加动作"));
    fireEvent.change(screen.getByLabelText("动作名称 1"), {
      target: { value: "标记赢单" },
    });
    fireEvent.click(screen.getByText("保存流程"));

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls[0][2].transitions[0].actions).toEqual([]);
  });

  it("renders the precise backend field path on the offending Action step", async () => {
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft: vi.fn().mockRejectedValue({
        code: "WORKFLOW_ACTION_INVALID",
        message: "流程执行动作配置不合法。",
        fieldErrors: {
          "transitions.0.actions.0.targetObjectCode": [
            "「targetObjectCode」不能为空。",
          ],
        },
        requestId: "req_action_1",
        status: 400,
      }),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    renderDesigner(api);

    fireEvent.click(await screen.findByText("添加动作"));
    fireEvent.change(screen.getByLabelText("动作名称 1"), {
      target: { value: "标记赢单" },
    });
    fireEvent.click(screen.getByText("添加执行动作"));
    fireEvent.click(screen.getByText("保存流程"));

    const path = await screen.findByText(
      "transitions.0.actions.0.targetObjectCode",
    );
    expect(path.closest("[data-action-step]")).toHaveAttribute(
      "data-action-step",
      "1",
    );
    expect(
      screen.getByText("「targetObjectCode」不能为空。"),
    ).toBeInTheDocument();
    // The generic envelope is still shown, not replaced by the located detail.
    expect(
      screen.getByText(/流程执行动作配置不合法。（请求编号：req_action_1）/),
    ).toBeInTheDocument();
  });

  it("surfaces a failed object-list query instead of an empty target select", async () => {
    const api: WorkflowApi = {
      getDraft: vi.fn().mockResolvedValue(emptyWorkflow()),
      saveDraft: vi.fn(),
      getRuntime: vi.fn(),
      executeTransition: vi.fn(),
      history: vi.fn(),
    };
    renderDesigner(
      api,
      objectApi({
        listDrafts: vi.fn().mockRejectedValue({
          code: "OBJECT_LIST_FAILED",
          message: "业务表列表加载失败。",
          fieldErrors: {},
          requestId: "req_objects_1",
          status: 500,
        }),
      }),
    );

    fireEvent.click(await screen.findByText("添加动作"));
    fireEvent.click(screen.getByText("添加执行动作"));

    // The CREATE_RECORD target select would otherwise just be empty.
    expect(openOptions("目标业务表 1-1")).toEqual([]);
    expect(
      await screen.findByText(
        "无法载入目标业务表列表：业务表列表加载失败。（请求编号：req_objects_1）",
      ),
    ).toBeInTheDocument();
  });
});
