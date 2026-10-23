import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObjectDesigner } from "./object-designer";
import type { ObjectApi } from "./object-api";
import type { ObjectDraft, ObjectDraftField } from "./object-types";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

function field(overrides: Partial<ObjectDraftField>): ObjectDraftField {
  return {
    id: "field-name",
    fieldKey: "customer_name",
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
    ...overrides,
  } as ObjectDraftField;
}

function draft(overrides: Partial<ObjectDraft> = {}): ObjectDraft {
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
      field({}),
      field({
        id: "field-phone",
        fieldKey: "contact_phone",
        label: "联系电话",
        type: "PHONE",
        required: false,
        sortOrder: 2,
        publishedType: "PHONE",
      }),
      field({
        id: "field-rating",
        fieldKey: "final_rating",
        label: "最终评级",
        type: "SINGLE_SELECT",
        required: false,
        sortOrder: 3,
        publishedType: null,
        config: { options: [{ key: "gold", label: "金牌" }] },
      }),
    ],
    defaultView: {
      name: "默认视图",
      columnFieldKeys: ["customer_name"],
      sort: { field: "updatedAt", direction: "desc" },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: "OWN",
      updateScope: "OWN",
    },
    publishedEmployeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: "OWN",
      updateScope: "OWN",
      fields: [],
    },
    activeRecordCount: 12,
    ...overrides,
  } as ObjectDraft;
}

function objectApi(overrides: Partial<ObjectApi> = {}): ObjectApi {
  return {
    listAccessible: vi.fn(),
    runtimeSchema: vi.fn(),
    listDrafts: vi.fn(),
    draft: vi.fn().mockResolvedValue(draft()),
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockResolvedValue(draft()),
    reorderObjects: vi.fn(),
    createField: vi.fn().mockResolvedValue(draft()),
    updateField: vi.fn().mockResolvedValue(draft()),
    reorderFields: vi.fn().mockResolvedValue(draft()),
    updateDefaultView: vi.fn().mockResolvedValue(draft()),
    updatePermissions: vi.fn().mockResolvedValue(draft()),
    analyzePublication: vi
      .fn()
      .mockResolvedValue({ blocking: [], warnings: [], changes: [] }),
    publish: vi.fn(),
    listPublications: vi.fn().mockResolvedValue([]),
    lifecycle: vi.fn(),
    restore: vi.fn(),
    archive: vi.fn(),
    removeDraft: vi.fn(),
    ...overrides,
  };
}

function renderDesigner(initialDraft: ObjectDraft, api: ObjectApi) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ObjectDesigner tenantCode="northwind" initialDraft={initialDraft} api={api} />
    </QueryClientProvider>,
  );
}

const row = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });
const editor = (label: string) => screen.getByRole("region", { name: `配置字段：${label}` });
const nameInput = () => screen.getByRole("textbox", { name: "字段名称" });

describe("field list and editor", () => {
  it("opens the first field and marks which row is being edited", () => {
    renderDesigner(draft(), objectApi());
    expect(editor("客户名称")).toBeInTheDocument();
    expect(row("客户名称")).toHaveAttribute("aria-current", "true");
    expect(row("联系电话")).not.toHaveAttribute("aria-current");
  });

  it("opens another field's saved configuration when its row is chosen", () => {
    renderDesigner(draft(), objectApi());
    fireEvent.click(row("联系电话"));
    expect(editor("联系电话")).toBeInTheDocument();
    expect(nameInput()).toHaveValue("联系电话");
    expect(row("联系电话")).toHaveAttribute("aria-current", "true");
  });

  it("states a draft-only field as unpublished, with its type still choosable", () => {
    renderDesigner(draft(), objectApi());
    fireEvent.click(row("最终评级"));
    expect(within(editor("最终评级")).getByText(/尚未发布/)).toBeInTheDocument();
  });

  it("offers save and restore only while there is something to save", () => {
    renderDesigner(draft(), objectApi());
    expect(screen.getByRole("button", { name: "保存字段" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^还\s*原$/ })).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: "公司名称" } });
    expect(screen.getByText("有未保存的修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存字段" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^还\s*原$/ }));
    expect(nameInput()).toHaveValue("客户名称");
    expect(screen.queryByText("有未保存的修改")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存字段" })).toBeDisabled();
  });

  it("saves with the displayed draft version, stays on the field and restarts from what was saved", async () => {
    const saved = draft({
      object: { ...draft().object, version: 5 },
      fields: draft().fields.map((item) =>
        item.id === "field-name" ? field({ label: "公司名称" }) : item,
      ),
    });
    const api = objectApi({ updateField: vi.fn().mockResolvedValue(saved) });
    renderDesigner(draft(), api);

    fireEvent.change(nameInput(), { target: { value: "公司名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    await waitFor(() =>
      expect(api.updateField).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        "field-name",
        expect.objectContaining({ expectedVersion: 4, label: "公司名称" }),
      ),
    );
    expect(await screen.findByRole("region", { name: "配置字段：公司名称" })).toBeInTheDocument();
    expect(nameInput()).toHaveValue("公司名称");
    expect(screen.getByText("字段已保存", { selector: "strong" })).toBeInTheDocument();
    // Confirmed beside the button only; a banner above would shift the editor down.
    expect(screen.getAllByText("字段已保存")).toHaveLength(1);
    expect(screen.queryByText("有未保存的修改")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存字段" })).toBeDisabled();
  });

  it("shows a failed save beside the button and keeps what was typed", async () => {
    const api = objectApi({
      updateField: vi.fn().mockRejectedValue({
        code: "VALIDATION_FAILED",
        message: "字段名称重复。",
        fieldErrors: {},
        requestId: "req_dup",
        status: 400,
      }),
    });
    renderDesigner(draft(), api);

    fireEvent.change(nameInput(), { target: { value: "联系电话" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字段" }));

    const panel = await screen.findByRole("region", { name: "配置字段：客户名称" });
    expect(await within(panel).findByText(/字段名称重复。/)).toBeInTheDocument();
    expect(nameInput()).toHaveValue("联系电话");
    expect(screen.getByRole("button", { name: "保存字段" })).toBeEnabled();
  });
});

describe("unsaved field edits", () => {
  function edit() {
    fireEvent.change(nameInput(), { target: { value: "公司名称" } });
  }

  it("asks before another field replaces unsaved edits, and keeps them on 继续编辑", async () => {
    renderDesigner(draft(), objectApi());
    edit();
    fireEvent.click(row("联系电话"));

    const dialog = await screen.findByRole("dialog", { name: "放弃未保存的修改？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "继续编辑" }));

    // Still on the same field with the typed value; the other field never opened.
    expect(editor("客户名称")).toBeInTheDocument();
    expect(nameInput()).toHaveValue("公司名称");
    expect(row("客户名称")).toHaveAttribute("aria-current", "true");
    expect(row("联系电话")).not.toHaveAttribute("aria-current");
  });

  it("moves on and drops the edits when the member chooses 放弃修改", async () => {
    renderDesigner(draft(), objectApi());
    edit();
    fireEvent.click(row("联系电话"));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).getByRole("button", {
        name: "放弃修改",
      }),
    );

    expect(await screen.findByRole("region", { name: "配置字段：联系电话" })).toBeInTheDocument();
    fireEvent.click(row("客户名称"));
    expect(nameInput()).toHaveValue("客户名称");
  });

  it("does not ask when nothing changed", () => {
    renderDesigner(draft(), objectApi());
    fireEvent.click(row("联系电话"));
    expect(screen.queryByRole("dialog", { name: "放弃未保存的修改？" })).not.toBeInTheDocument();
    expect(editor("联系电话")).toBeInTheDocument();
  });

  it("holds publishing back while edits are unsaved", () => {
    renderDesigner(draft(), objectApi());
    expect(screen.getByRole("button", { name: "发布变更" })).toBeEnabled();
    edit();
    expect(screen.getByRole("button", { name: "发布变更" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^还\s*原$/ }));
    expect(screen.getByRole("button", { name: "发布变更" })).toBeEnabled();
  });

  it("asks before leaving the fields step, and stays on it until the member agrees", async () => {
    renderDesigner(draft(), objectApi());
    edit();
    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));
    expect(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^字段与表单/ })).toHaveAttribute("aria-current", "page");
  });

  it("asks before adding a field, which would open a different editor", async () => {
    renderDesigner(draft(), objectApi());
    edit();
    fireEvent.click(screen.getByRole("button", { name: "新增字段" }));
    expect(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建并继续配置" })).not.toBeInTheDocument();
  });

  it("lets the member leave the fields step after choosing 放弃修改, and publishing is available again", async () => {
    renderDesigner(draft(), objectApi());
    edit();
    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).getByRole("button", {
        name: "放弃修改",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "列表展示与搜索" })).toHaveAttribute("aria-current", "page"),
    );
    expect(screen.getByRole("button", { name: "发布变更" })).toBeEnabled();
  });
});

describe("field order", () => {
  it("keeps a field's unsaved edits when another change bumps the draft version", async () => {
    const reordered = draft({
      object: { ...draft().object, version: 5 },
      fields: [draft().fields[1], draft().fields[0], draft().fields[2]],
    });
    const api = objectApi({ reorderFields: vi.fn().mockResolvedValue(reordered) });
    renderDesigner(draft(), api);

    fireEvent.change(nameInput(), { target: { value: "公司名称" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "拖动调整 联系电话" }), {
      key: "ArrowUp",
    });

    await waitFor(() =>
      expect(api.reorderFields).toHaveBeenCalledWith("northwind", "object-1", {
        expectedVersion: 4,
        fieldIds: ["field-phone", "field-name", "field-rating"],
      }),
    );
    const items = await screen.findAllByRole("listitem");
    await waitFor(() => expect(items[0]).toHaveTextContent("联系电话"));
    // The edit survived the reorder, and is still marked as unsaved.
    expect(nameInput()).toHaveValue("公司名称");
    expect(screen.getByText("有未保存的修改")).toBeInTheDocument();
  });

  it("puts keyboard focus back on the moved handle so arrow presses can continue", async () => {
    const reordered = draft({
      object: { ...draft().object, version: 5 },
      fields: [draft().fields[1], draft().fields[0], draft().fields[2]],
    });
    const api = objectApi({ reorderFields: vi.fn().mockResolvedValue(reordered) });
    renderDesigner(draft(), api);

    const handle = screen.getByRole("button", { name: "拖动调整 联系电话" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("联系电话"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "拖动调整 联系电话" })).toHaveFocus(),
    );
  });

  it("does not move the first field up or the last field down", () => {
    const api = objectApi();
    renderDesigner(draft(), api);
    fireEvent.keyDown(screen.getByRole("button", { name: "拖动调整 客户名称" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("button", { name: "拖动调整 最终评级" }), { key: "ArrowDown" });
    expect(api.reorderFields).not.toHaveBeenCalled();
  });
});

describe("designer without fields", () => {
  it("invites the first field instead of showing an empty editor", () => {
    renderDesigner(draft({ fields: [] }), objectApi());
    expect(screen.getByText(/还没有字段/)).toBeInTheDocument();
    expect(screen.getByText(/添加字段后，在这里设置/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存字段" })).not.toBeInTheDocument();
  });
});
