import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObjectList } from "./object-list";
import { ObjectDesigner } from "./object-designer";
import { FieldEditorDrawer } from "./field-editor-drawer";
import type { ConfigurableFieldView } from "./configuration-view";
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
        id: "field-rating",
        fieldKey: "final_rating",
        label: "最终评级",
        type: "SINGLE_SELECT",
        required: false,
        sortOrder: 2,
        publishedType: null,
        employeeAccess: "READ_ONLY",
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
      canRead: false,
      canUpdate: false,
      canDelete: false,
      readScope: "OWN",
      updateScope: "OWN",
      fields: [
        { fieldKey: "customer_name", label: "客户名称", access: "READ_ONLY" },
      ],
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
    publish: vi.fn().mockResolvedValue({
      id: "publication-4",
      number: 4,
      sourceDraftVersion: 4,
      publishedAt: "2026-08-21T00:00:00.000Z",
      changes: [],
    }),
    listPublications: vi.fn().mockResolvedValue([]),
    lifecycle: vi.fn(),
    restore: vi.fn(),
    archive: vi.fn(),
    removeDraft: vi.fn().mockResolvedValue({ deleted: true }),
    ...overrides,
  };
}

/** The list row that selects a field for editing. */
function fieldRow(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

function renderDesigner(initialDraft: ObjectDraft, api: ObjectApi) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ObjectDesigner
        tenantCode="northwind"
        initialDraft={initialDraft}
        api={api}
      />
    </QueryClientProvider>,
  );
}

describe("ObjectDesigner configuration ledger", () => {
  it("confirms field retirement and restoration as draft changes without publishing", async () => {
    const initial = draft();
    const retired = draft({
      object: { ...initial.object, version: 5, hasUnpublishedChanges: true },
      fields: initial.fields.map((item) =>
        item.id === "field-rating" ? { ...item, status: "INACTIVE" } : item,
      ),
    });
    const api = objectApi({
      updateField: vi
        .fn()
        .mockResolvedValueOnce(retired)
        .mockResolvedValueOnce(initial),
    });
    renderDesigner(initial, api);
    fireEvent.click(fieldRow("最终评级"));
    fireEvent.click(screen.getByRole("button", { name: "停用字段 最终评级" }));
    expect(api.updateField).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("历史数据保留");
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() =>
      expect(api.updateField).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        "field-rating",
        { expectedVersion: 4, status: "INACTIVE" },
      ),
    );
    expect(
      await screen.findByText("字段已停用并保存到草稿，发布后生效"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复字段 最终评级" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() =>
      expect(api.updateField).toHaveBeenLastCalledWith(
        "northwind",
        "object-1",
        "field-rating",
        { expectedVersion: 5, status: "ACTIVE" },
      ),
    );
    expect(api.publish).not.toHaveBeenCalled();
  });

  it("explains why the record title cannot be retired", () => {
    renderDesigner(draft(), objectApi());
    // The first field opens by default.
    fireEvent.click(screen.getByRole("button", { name: "停用字段 客户名称" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "请先在基本设置中更换记录名称字段",
    );
    expect(screen.getByRole("button", { name: "确认停用" })).toBeDisabled();
  });

  it("keeps the field active and reports a version conflict when retirement fails", async () => {
    const api = objectApi({
      updateField: vi.fn().mockRejectedValue({
        code: "CONFIG_VERSION_CONFLICT",
        message: "配置已更新，请重新载入",
        status: 409,
        requestId: "status-conflict",
      }),
    });
    renderDesigner(draft(), api);
    fireEvent.click(fieldRow("最终评级"));
    fireEvent.click(screen.getByRole("button", { name: "停用字段 最终评级" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("配置已更新"),
    );
    expect(
      screen.getByRole("button", { name: "停用字段 最终评级" }),
    ).toBeInTheDocument();
  });

  it("identifies the editing section, draft and employee live version with a mobile return path", () => {
    renderDesigner(draft(), objectApi());
    // The active tab names the section; the header carries draft and live version.
    expect(screen.getByRole("button", { name: /^字段与表单/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("草稿修订 4")).toBeInTheDocument();
    expect(screen.getByText("员工使用 v3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "业务表" })).toHaveAttribute(
      "href",
      "/workspace/northwind/settings/objects",
    );
    for (const [section, save] of [
      ["基本设置", "保存基本设置"],
      ["列表展示与搜索", "保存列表设置"],
      ["员工权限", "保存员工权限"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: section }));
      expect(screen.getByRole("button", { name: section })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const action = screen.getByRole("button", { name: save }).parentElement!;
      expect(
        within(action).getByText("仅保存本节到对象草稿；发布后员工端生效。"),
      ).toBeInTheDocument();
    }
  });
  it("saves the chosen icon with the basics, and clears it back to the default", async () => {
    const api = objectApi();
    const view = renderDesigner(draft(), api);
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));
    expect(screen.getByRole("radio", { name: "默认" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "团队" }));
    fireEvent.click(screen.getByRole("button", { name: "保存基本设置" }));
    await waitFor(() =>
      expect(api.updateDraft).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        expect.objectContaining({ expectedVersion: 4, icon: "team" }),
      ),
    );
    view.unmount();

    const stored = objectApi();
    renderDesigner(
      draft({ object: { ...draft().object, icon: "team" } }),
      stored,
    );
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));
    expect(screen.getByRole("radio", { name: "团队" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "默认" }));
    fireEvent.click(screen.getByRole("button", { name: "保存基本设置" }));
    await waitFor(() =>
      expect(stored.updateDraft).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        expect.objectContaining({ icon: null }),
      ),
    );
  });

  it("shows the stable identity as tenantCode plus objectCode", () => {
    renderDesigner(draft(), objectApi());
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));
    expect(screen.getByText("northwind + customers")).toBeInTheDocument();
    expect(
      screen.getByText(/稳定标识是 northwind \+ 业务表代码/),
    ).toBeInTheDocument();
  });

  it("explains that object field save persists the draft while the shared default still needs parent save", () => {
    const view = renderDesigner(draft(), objectApi());
    // The first field is open in the editor beside the list without any click.
    expect(
      screen.getByRole("region", { name: "配置字段：客户名称" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "保存字段直接写入对象草稿；字段访问变更随后单独保存，发布后员工端生效。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("保存后仍需保存对象或模板草稿。"),
    ).not.toBeInTheDocument();
    view.unmount();
    render(
      <FieldEditorDrawer
        field={field({}) as unknown as ConfigurableFieldView}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("保存后仍需保存对象或模板草稿。"),
    ).toBeInTheDocument();
  });

  it("creates a field from the prominent field action", async () => {
    const nextDraft = draft({
      object: { ...draft().object, version: 5 },
      fields: [
        ...draft().fields,
        field({
          id: "field-phone",
          fieldKey: "contact_phone",
          label: "联系电话",
          type: "PHONE",
          required: false,
          sortOrder: 3,
          publishedType: null,
        }),
      ],
    });
    const api = objectApi({
      createField: vi.fn().mockResolvedValue(nextDraft),
    });
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "新增字段" }));
    const creator = await screen.findByRole("dialog");
    fireEvent.change(within(creator).getByLabelText("字段名称"), {
      target: { value: "联系电话" },
    });
    fireEvent.change(within(creator).getByLabelText("字段键"), {
      target: { value: "contact_phone" },
    });
    fireEvent.mouseDown(within(creator).getByLabelText("字段类型"));
    fireEvent.click(screen.getByTitle("电话"));
    fireEvent.click(screen.getByRole("button", { name: "创建并继续配置" }));

    await waitFor(() =>
      expect(api.createField).toHaveBeenCalledWith("northwind", "object-1", {
        expectedVersion: 4,
        fieldKey: "contact_phone",
        label: "联系电话",
        type: "PHONE",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        isSystem: false,
      }),
    );
    // The new field is selected, so the editor now shows it.
    expect(
      await screen.findByRole("region", { name: "配置字段：联系电话" }),
    ).toBeInTheDocument();
  });

  it("edits and saves the default list view", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));
    fireEvent.change(screen.getByLabelText("视图名称"), {
      target: { value: "客户总览" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存列表设置" }));

    await waitFor(() =>
      expect(api.updateDefaultView).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        {
          expectedVersion: 4,
          name: "客户总览",
          columnFieldKeys: ["customer_name"],
          searchFieldKeys: [],
          sort: { field: "updatedAt", direction: "desc" },
        },
      ),
    );
    expect(await screen.findByText("列表设置已保存")).toBeInTheDocument();
  });

  it("widens the read scope when employee reading is granted", async () => {
    const api = objectApi();
    renderDesigner(
      draft({
        employeeAccess: {
          canCreate: false,
          canRead: false,
          canUpdate: false,
          canDelete: false,
          readScope: "NONE",
          updateScope: "NONE",
        },
      }),
      api,
    );

    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    fireEvent.click(screen.getByRole("switch", { name: "可以查看记录" }));
    fireEvent.click(screen.getByRole("button", { name: "保存员工权限" }));

    await waitFor(() =>
      expect(api.updatePermissions).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        expect.objectContaining({ canRead: true, readScope: "ALL" }),
      ),
    );
  });

  it("saves extra searchable fields that are not list columns", async () => {
    const api = objectApi();
    renderDesigner(
      draft({
        fields: [
          field({}),
          field({
            id: "field-phone",
            fieldKey: "contact_phone",
            label: "联系电话",
            type: "PHONE",
            required: false,
            sortOrder: 3,
            publishedType: "PHONE",
          }),
        ],
      }),
      api,
    );

    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "将联系电话纳入关键词搜索" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存列表设置" }));

    await waitFor(() =>
      expect(api.updateDefaultView).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        {
          expectedVersion: 4,
          name: "默认视图",
          columnFieldKeys: ["customer_name"],
          searchFieldKeys: ["contact_phone"],
          sort: { field: "updatedAt", direction: "desc" },
        },
      ),
    );
  });

  it("renders the column list in the saved view order", () => {
    const api = objectApi();
    renderDesigner(
      draft({
        fields: [
          field({}),
          field({
            id: "field-phone",
            fieldKey: "contact_phone",
            label: "联系电话",
            type: "PHONE",
            required: false,
            sortOrder: 3,
            publishedType: "PHONE",
          }),
        ],
        defaultView: {
          name: "默认视图",
          columnFieldKeys: ["contact_phone", "customer_name"],
          sort: { field: "updatedAt", direction: "desc" },
        },
      }),
      api,
    );

    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));

    const keys = [...document.querySelectorAll('input[type="checkbox"]')]
      .slice(0, 2)
      .map(
        (input) => input.closest("label")?.querySelector("code")?.textContent,
      );
    expect(keys).toEqual(["contact_phone", "customer_name"]);
  });

  it("deletes a draft that was never published", async () => {
    const api = objectApi();
    const base = draft();
    renderDesigner(
      draft({
        object: { ...base.object, publicationNumber: null, publishedAt: null },
      }),
      api,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除草稿" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(api.removeDraft).toHaveBeenCalledWith("northwind", "object-1", 4),
    );
  });

  it("hides draft deletion once the object published", () => {
    renderDesigner(draft(), objectApi());

    expect(
      screen.queryByRole("button", { name: "删除草稿" }),
    ).not.toBeInTheDocument();
  });

  it("shows the object identity, live version and no pending change", () => {
    renderDesigner(draft(), objectApi());

    expect(
      screen.getByRole("heading", { name: "客户资料" }),
    ).toBeInTheDocument();
    expect(screen.getByText("northwind + customers")).toBeInTheDocument();
    expect(screen.getByText("员工使用 v3")).toBeInTheDocument();
    expect(screen.queryByText(/项未发布变更/)).not.toBeInTheDocument();
  });

  it("counts the pending changes waiting for a publication", () => {
    renderDesigner(
      draft({
        object: { ...draft().object, version: 6, hasUnpublishedChanges: true },
      }),
      objectApi(),
    );

    expect(screen.getByText("有待发布改动")).toBeInTheDocument();
  });

  it("lists each field with its stable key, type, requirement and employee access", () => {
    renderDesigner(draft(), objectApi());

    const list = screen.getByRole("list", { name: "字段清单" });
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("客户名称");
    expect(rows[0]).toHaveTextContent("customer_name");
    expect(rows[0]).toHaveTextContent("文本");
    expect(rows[0]).toHaveTextContent("必填");
    expect(rows[0]).toHaveTextContent("员工可编辑");
    expect(rows[0]).toHaveTextContent("记录名称");
    expect(rows[1]).toHaveTextContent("final_rating");
    expect(rows[1]).toHaveTextContent("单选");
    expect(rows[1]).toHaveTextContent("员工只读");
    // Optional is the default, so only a required field carries a flag.
    expect(rows[1]).not.toHaveTextContent("必填");
    expect(rows[1]).toHaveTextContent("未发布");
  });

  it("keeps the field list visible and locks a published field type", () => {
    renderDesigner(draft(), objectApi());

    expect(screen.getByRole("list", { name: "字段清单" })).toBeInTheDocument();
    fireEvent.click(fieldRow("客户名称"));

    expect(screen.getByLabelText("数据类型")).toBeDisabled();
    expect(
      screen.getByText("字段发布后不能更改数据类型。"),
    ).toBeInTheDocument();
  });

  it("still allows choosing the data type of a field that was never published", () => {
    renderDesigner(draft(), objectApi());

    fireEvent.click(fieldRow("最终评级"));

    expect(screen.getByLabelText("数据类型")).toBeEnabled();
    expect(
      screen.queryByText("字段发布后不能更改数据类型。"),
    ).not.toBeInTheDocument();
  });

  it("lets an administrator replace generated option keys and choose colors", () => {
    renderDesigner(draft(), objectApi());

    fireEvent.click(fieldRow("最终评级"));

    expect(screen.getByLabelText("选项键 gold")).toHaveValue("gold");
    expect(screen.getByLabelText("选项颜色 gold")).toBeInTheDocument();
  });

  it("reorders fields from the drag handle keyboard control and saves the resulting order", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.keyDown(
      screen.getByRole("button", { name: "拖动调整 最终评级" }),
      { key: "ArrowUp" },
    );

    await waitFor(() =>
      expect(api.reorderFields).toHaveBeenCalledWith("northwind", "object-1", {
        expectedVersion: 4,
        fieldIds: ["field-rating", "field-name"],
      }),
    );
    expect(
      screen.queryByRole("button", { name: "上移 最终评级" }),
    ).not.toBeInTheDocument();
  });
});

describe("ObjectDesigner publication flow", () => {
  it("analyses the draft before offering to publish", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "发布变更" }));

    await waitFor(() =>
      expect(api.analyzePublication).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        4,
      ),
    );
    expect(api.publish).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "确认发布" }),
    ).toBeEnabled();
  });

  it("publishes with the expected version only after the analysis is confirmed", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "发布变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发布" }));

    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith("northwind", "object-1", 4),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps the draft untouched and offers a reload when the version conflicts", async () => {
    const api = objectApi({
      publish: vi.fn().mockRejectedValue({
        code: "CONFIG_VERSION_CONFLICT",
        message: "配置版本冲突。",
        fieldErrors: {},
        requestId: "req_conflict",
        status: 409,
      }),
    });
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "发布变更" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发布" }));

    expect(
      await screen.findByRole("button", { name: "重新载入配置" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "字段清单" })).toHaveTextContent(
      "customer_name",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("ObjectDesigner employee preview", () => {
  it("keeps the employee preview out of the page until it is asked for", async () => {
    renderDesigner(draft(), objectApi());
    expect(
      screen.queryByRole("region", { name: "权限预览" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开员工端预览" }));

    expect(
      await screen.findByRole("dialog", { name: "员工端预览" }),
    ).toBeInTheDocument();
  });

  it("hides a hidden field and drops the create action from the employee view", async () => {
    renderDesigner(
      draft({
        fields: [
          field({}),
          field({
            id: "field-secret",
            fieldKey: "internal_score",
            label: "内部评分",
            sortOrder: 2,
            employeeAccess: "HIDDEN",
            publishedType: null,
          }),
        ],
        employeeAccess: {
          canCreate: false,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: "OWN",
          updateScope: "OWN",
        },
      }),
      objectApi(),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开员工端预览" }));
    fireEvent.click(await screen.findByRole("radio", { name: "员工视角" }));
    const preview = screen.getByRole("region", { name: "权限预览" });

    expect(within(preview).getByText("客户名称")).toBeInTheDocument();
    expect(within(preview).queryByText("内部评分")).not.toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: "新建记录" }),
    ).not.toBeInTheDocument();
    expect(within(preview).getByText("我的客户资料")).toBeInTheDocument();
  });

  it("shows the administrator every field and the create action", async () => {
    renderDesigner(
      draft({
        fields: [
          field({}),
          field({
            id: "field-secret",
            fieldKey: "internal_score",
            label: "内部评分",
            sortOrder: 2,
            employeeAccess: "HIDDEN",
            publishedType: null,
          }),
        ],
      }),
      objectApi(),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开员工端预览" }));
    const preview = await screen.findByRole("region", { name: "权限预览" });

    expect(within(preview).getByText("内部评分")).toBeInTheDocument();
    expect(
      within(preview).getByRole("button", { name: "新建记录" }),
    ).toBeInTheDocument();
  });
});

describe("employee permissions publication status", () => {
  it("compares published defaults with the saved draft and labels unsaved inputs", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);
    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    const comparison = screen.getByRole("table", { name: "员工默认权限对照" });
    expect(comparison).toHaveTextContent("当前生效 · v3");
    expect(comparison).toHaveTextContent("已保存草稿");
    expect(comparison).toHaveTextContent("禁止查看");
    expect(comparison).toHaveTextContent("仅本人负责");
    expect(comparison).toHaveTextContent("客户名称");
    expect(screen.getByText("员工默认权限有待发布修改")).toBeInTheDocument();
    expect(
      screen.getByText(/单独授权优先于这里的默认权限/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "可以查看记录" }));
    expect(
      screen.getByText("有未保存的权限修改，请先保存再发布。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发布变更" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "检查并发布" })).toBeDisabled();
    expect(api.updatePermissions).not.toHaveBeenCalled();
  });

  it("keeps live defaults on save, explains publication, and refreshes them after publishing", async () => {
    const saved = draft({
      object: { ...draft().object, version: 5, hasUnpublishedChanges: true },
      employeeAccess: { ...draft().employeeAccess!, canCreate: false },
    });
    const live = draft({
      ...saved,
      object: {
        ...saved.object,
        publicationNumber: 4,
        hasUnpublishedChanges: false,
      },
      publishedEmployeeAccess: {
        ...saved.employeeAccess!,
        fields: saved.fields.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          access: f.employeeAccess,
        })),
      },
    });
    const api = objectApi({
      updatePermissions: vi.fn().mockResolvedValue(saved),
      draft: vi.fn().mockResolvedValue(live),
    });
    renderDesigner(draft(), api);
    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    fireEvent.click(screen.getByRole("switch", { name: "可以新建记录" }));
    fireEvent.click(screen.getByRole("button", { name: "保存员工权限" }));
    expect(
      await screen.findByText(
        "员工权限已保存到草稿，尚未生效。请检查并发布变更。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "员工默认权限对照" }),
    ).toHaveTextContent("当前生效 · v3");
    expect(
      screen.queryByText("有未保存的权限修改，请先保存再发布。"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查并发布" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "本次发布会应用此业务表全部已保存的配置，包括员工默认权限。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("本次发布没有配置变更。"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "确认发布" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));
    expect(await screen.findByText("当前生效 · v4")).toBeInTheDocument();
    expect(
      screen.getByText("已保存的员工默认权限与当前生效版本一致"),
    ).toBeInTheDocument();
  });

  it("does not promote failed saves or failed publications to live permissions", async () => {
    const api = objectApi({
      updatePermissions: vi.fn().mockRejectedValue(new Error("保存失败")),
      publish: vi.fn().mockRejectedValue(new Error("发布失败")),
    });
    renderDesigner(draft(), api);
    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    fireEvent.click(screen.getByRole("switch", { name: "可以新建记录" }));
    fireEvent.click(screen.getByRole("button", { name: "保存员工权限" }));
    await waitFor(() => expect(api.updatePermissions).toHaveBeenCalledOnce());
    expect(screen.getByText("当前生效 · v3")).toBeInTheDocument();
    expect(
      screen.getByText("有未保存的权限修改，请先保存再发布。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "可以新建记录" }));
    fireEvent.click(screen.getByRole("button", { name: "检查并发布" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "确认发布" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledOnce());
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("当前生效 · v3")).toBeInTheDocument();
    expect(api.draft).not.toHaveBeenCalled();
  });

  it("does not call never-published permissions effective", () => {
    renderDesigner(
      draft({
        publishedEmployeeAccess: null,
        object: { ...draft().object, publicationNumber: null, status: "DRAFT" },
      }),
      objectApi(),
    );
    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    expect(
      screen.getByText("尚未发布，员工暂不可访问此业务表。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/当前生效 · v/)).not.toBeInTheDocument();
  });
});

describe("whole-table lifecycle", () => {
  const preview = {
    status: "ACTIVE",
    version: 4,
    recordCount: 12,
    activePublicationVersion: 3,
    archivedAt: null,
    hasUnpublishedChanges: true,
    blockers: [],
    expiredRecordCount: 2,
    requiresLegacyTimerAcknowledgement: false,
  };
  async function openLifecycle(
    initial = draft(),
    overrides: Partial<ObjectApi> = {},
  ) {
    const api = objectApi({
      lifecycle: vi.fn().mockResolvedValue(preview),
      restore: vi.fn(),
      ...overrides,
    });
    renderDesigner(initial, api);
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));
    fireEvent.click(
      screen.getByRole("button", {
        name:
          initial.object.status === "ARCHIVED" ? "恢复业务表" : "停用业务表",
      }),
    );
    await screen.findByText("12 条业务记录");
    return api;
  }
  it("previews immediate impact and cancels without mutating records", async () => {
    const api = await openLifecycle();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("v3");
    expect(dialog).toHaveTextContent("待发布草稿");
    expect(dialog).toHaveTextContent("立即生效");
    expect(dialog).toHaveTextContent("附件");
    expect(dialog).toHaveTextContent("没有阻止操作的依赖");
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
    expect(api.archive).not.toHaveBeenCalled();
  });
  it("blocks archive with actionable dependencies and does not call it a version conflict", async () => {
    const api = await openLifecycle(draft(), {
      lifecycle: vi.fn().mockResolvedValue({
        ...preview,
        blockers: [
          {
            kind: "WORKFLOW",
            objectCode: "orders",
            objectName: "订单",
            description: "签约动作写入客户，请先修改已发布流程",
          },
        ],
      }),
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("签约动作写入客户");
    expect(screen.getByRole("button", { name: "确认停用" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "重新载入配置" }),
    ).not.toBeInTheDocument();
    expect(api.archive).not.toHaveBeenCalled();
  });
  it("archives once with the viewed version and immediately refreshes navigation", async () => {
    const initial = draft();
    const stopped = draft({
      object: {
        ...initial.object,
        status: "ARCHIVED",
        version: 5,
        archivedAt: "2026-10-20T00:00:00Z",
      },
    });
    const api = await openLifecycle(initial, {
      archive: vi.fn().mockResolvedValue(stopped),
    });
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await screen.findByRole("button", { name: "恢复业务表" });
    expect(api.archive).toHaveBeenCalledExactlyOnceWith(
      "northwind",
      "object-1",
      4,
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存基本设置" })).toBeDisabled();
  });
  it("requires legacy timer acknowledgement and restores the old publication without publishing", async () => {
    const initial = draft({
      object: { ...draft().object, status: "ARCHIVED" },
    });
    const api = await openLifecycle(initial, {
      lifecycle: vi.fn().mockResolvedValue({
        ...preview,
        status: "ARCHIVED",
        requiresLegacyTimerAcknowledgement: true,
      }),
      restore: vi.fn().mockResolvedValue(draft()),
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("2 条已到期");
    expect(screen.getByRole("dialog")).toHaveTextContent("草稿不会发布");
    expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /保留原有公海期限/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledExactlyOnceWith(
        "northwind",
        "object-1",
        4,
        true,
      ),
    );
    expect(api.publish).not.toHaveBeenCalled();
  });
  it("requires deliberate config refresh for a stale preview", async () => {
    const api = await openLifecycle(draft(), {
      lifecycle: vi.fn().mockResolvedValue({ ...preview, version: 5 }),
    });
    expect(screen.getByRole("button", { name: "确认停用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新载入配置" }));
    await waitFor(() => expect(api.draft).toHaveBeenCalled());
    expect(api.archive).not.toHaveBeenCalled();
  });
  it("keeps preview failures retryable and never enables unverified archive", async () => {
    const failure = {
      code: "INTERNAL_ERROR",
      message: "检查暂时失败",
      status: 500,
      requestId: "preview-test",
    };
    const api = objectApi({
      lifecycle: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(preview),
      restore: vi.fn(),
    });
    renderDesigner(draft(), api);
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));
    fireEvent.click(screen.getByRole("button", { name: "停用业务表" }));
    await screen.findByText(/检查暂时失败/);
    expect(screen.getByRole("button", { name: "确认停用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试检查" }));
    await screen.findByText("12 条业务记录");
    expect(screen.getByRole("button", { name: "确认停用" })).toBeEnabled();
  });
  it("locks confirmation while a mutation is pending", async () => {
    let finish!: (next: ObjectDraft) => void;
    const archive = vi.fn().mockReturnValue(
      new Promise<ObjectDraft>((resolve) => {
        finish = resolve;
      }),
    );
    const api = await openLifecycle(draft(), { archive });
    fireEvent.click(screen.getByRole("button", { name: /确认停用/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /确认停用/ })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /取\s*消/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /确认停用/ }));
    expect(api.archive).toHaveBeenCalledTimes(1);
    finish(
      draft({ object: { ...draft().object, status: "ARCHIVED", version: 5 } }),
    );
    await screen.findByRole("button", { name: "恢复业务表" });
  });
  it("keeps a raced dependency failure visible and retryable without a stale-version label", async () => {
    const api = await openLifecycle(draft(), {
      archive: vi.fn().mockRejectedValue({
        code: "OBJECT_LIFECYCLE_BLOCKED",
        message: "订单流程需要此表，请先处理依赖",
        status: 409,
        requestId: "blocked-test",
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await screen.findByText(/订单流程需要此表/);
    expect(
      screen.queryByRole("button", { name: "重新载入配置" }),
    ).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重试检查" })).toBeEnabled();
    expect(api.publish).not.toHaveBeenCalled();
  });
  it("reloads explicitly after a mutation version conflict without retrying the stale mutation", async () => {
    const api = await openLifecycle(draft(), {
      archive: vi.fn().mockRejectedValue({
        code: "CONFIG_VERSION_CONFLICT",
        message: "版本已变化",
        status: 409,
        requestId: "stale-test",
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await screen.findByText(/版本已变化/);
    expect(screen.getByRole("button", { name: "确认停用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新载入配置" }));
    await waitFor(() =>
      expect(api.draft).toHaveBeenCalledExactlyOnceWith(
        "northwind",
        "object-1",
      ),
    );
    expect(api.archive).toHaveBeenCalledTimes(1);
  });
  it("keeps archived field details inspectable while disabling edits and ordering", () => {
    renderDesigner(
      draft({ object: { ...draft().object, status: "ARCHIVED" } }),
      objectApi(),
    );
    expect(
      screen.getByRole("button", { name: "拖动调整 客户名称" }),
    ).toBeDisabled();
    fireEvent.click(fieldRow("最终评级"));
    const dialog = screen.getByRole("region", { name: "配置字段：最终评级" });
    expect(within(dialog).getByLabelText("字段名称")).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "添加选项" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("switch", { name: "停用选项 gold" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "保存字段" }),
    ).toBeDisabled();
  });
  it("locks the keys of a published select's options but not of new or unpublished ones", () => {
    const base = draft();
    const published = draft({
      fields: [
        base.fields[0],
        { ...base.fields[1], publishedType: "SINGLE_SELECT" },
      ],
    });
    const { unmount } = renderDesigner(published, objectApi());
    fireEvent.click(fieldRow("最终评级"));
    let dialog = screen.getByRole("region", { name: "配置字段：最终评级" });
    expect(within(dialog).getByLabelText("选项键 gold")).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "添加选项" }));
    expect(
      within(dialog).getByLabelText("选项键 option_2"),
    ).not.toHaveAttribute("readonly");
    unmount();

    renderDesigner(draft(), objectApi());
    fireEvent.click(fieldRow("最终评级"));
    dialog = screen.getByRole("region", { name: "配置字段：最终评级" });
    expect(within(dialog).getByLabelText("选项键 gold")).not.toHaveAttribute(
      "readonly",
    );
  });
  it("disables archived view custom controls and permission saves", () => {
    renderDesigner(
      draft({ object: { ...draft().object, status: "ARCHIVED" } }),
      objectApi(),
    );
    fireEvent.click(screen.getByRole("button", { name: "列表展示与搜索" }));
    expect(screen.getByLabelText("视图名称")).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /客户名称customer_name/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存列表设置" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "员工权限" }));
    expect(screen.getByRole("switch", { name: "可以新建记录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存员工权限" })).toBeDisabled();
  });
});

describe("object management lifecycle filters and ordering", () => {
  it("filters all lifecycle states and reorders editable rows without archived objects", async () => {
    const active = draft();
    const stopped = draft({
      object: {
        ...active.object,
        id: "stopped",
        name: "停用客户",
        status: "ARCHIVED",
      },
    });
    const unpublished = draft({
      object: {
        ...active.object,
        id: "new",
        name: "新表",
        status: "DRAFT",
        publicationNumber: null,
      },
    });
    const api = objectApi({
      listDrafts: vi.fn().mockResolvedValue([active, stopped, unpublished]),
      reorderObjects: vi.fn().mockResolvedValue([unpublished, stopped, active]),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ObjectList
          tenantCode="northwind"
          initialDrafts={[active, stopped, unpublished]}
          api={api}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: /^已停用/ }));
    expect(
      screen.queryByRole("link", { name: /^客户资料/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^停用客户/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多操作 停用客户" }));
    expect(
      await screen.findByRole("menuitem", { name: "恢复业务表" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^未发布/ }));
    expect(screen.getByRole("link", { name: /^新表/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^停用客户/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^全部/ }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作 客户资料" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /在导航中下移/ }),
    );
    await waitFor(() =>
      expect(api.reorderObjects).toHaveBeenCalledExactlyOnceWith("northwind", [
        { objectId: "new", expectedVersion: 4 },
        { objectId: "object-1", expectedVersion: 4 },
      ]),
    );
  });
});
