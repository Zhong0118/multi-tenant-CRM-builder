import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObjectDesigner } from "./object-designer";
import type { ObjectApi } from "./object-api";
import type { ObjectDraft, ObjectDraftField } from "./object-types";

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
    archive: vi.fn(),
    ...overrides,
  };
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
    fireEvent.change(screen.getByLabelText("字段名称"), {
      target: { value: "联系电话" },
    });
    fireEvent.change(screen.getByLabelText("字段键"), {
      target: { value: "contact_phone" },
    });
    fireEvent.mouseDown(screen.getByLabelText("字段类型"));
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
    expect((await screen.findAllByText("联系电话")).length).toBeGreaterThan(0);
  });

  it("edits and saves the default list view", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    fireEvent.change(screen.getByLabelText("视图名称"), {
      target: { value: "客户总览" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存列表视图" }));

    await waitFor(() =>
      expect(api.updateDefaultView).toHaveBeenCalledWith(
        "northwind",
        "object-1",
        {
          expectedVersion: 4,
          name: "客户总览",
          columnFieldKeys: ["customer_name"],
          sort: { field: "updatedAt", direction: "desc" },
        },
      ),
    );
  });

  it("shows the object identity, live version and no pending change", () => {
    renderDesigner(draft(), objectApi());

    expect(
      screen.getByRole("heading", { name: "客户资料" }),
    ).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();
    expect(screen.getByText("v3 当前版本")).toBeInTheDocument();
    expect(screen.queryByText(/项未发布变更/)).not.toBeInTheDocument();
  });

  it("counts the pending changes waiting for a publication", () => {
    renderDesigner(
      draft({
        object: { ...draft().object, version: 6, hasUnpublishedChanges: true },
      }),
      objectApi(),
    );

    expect(screen.getByText("有未发布变更")).toBeInTheDocument();
  });

  it("lists each field with its stable key, type, requirement and employee access", () => {
    renderDesigner(draft(), objectApi());

    const ledger = screen.getByRole("table", { name: "字段账本" });
    const rows = within(ledger).getAllByRole("row").slice(1);

    expect(rows[0]).toHaveTextContent("客户名称");
    expect(rows[0]).toHaveTextContent("customer_name");
    expect(rows[0]).toHaveTextContent("文本");
    expect(rows[0]).toHaveTextContent("必填");
    expect(rows[0]).toHaveTextContent("可编辑");
    expect(rows[1]).toHaveTextContent("final_rating");
    expect(rows[1]).toHaveTextContent("单选");
    expect(rows[1]).toHaveTextContent("可选");
    expect(rows[1]).toHaveTextContent("只读");
  });

  it("keeps the shared field ledger visible and locks a published field type", () => {
    renderDesigner(draft(), objectApi());

    expect(screen.getByRole("table", { name: "字段账本" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "配置字段 客户名称" }));

    expect(screen.getByLabelText("数据类型")).toBeDisabled();
    expect(
      screen.getByText("字段发布后不能更改数据类型。"),
    ).toBeInTheDocument();
  });

  it("still allows choosing the data type of a field that was never published", () => {
    renderDesigner(draft(), objectApi());

    fireEvent.click(screen.getByRole("button", { name: "配置字段 最终评级" }));

    expect(screen.getByLabelText("数据类型")).toBeEnabled();
    expect(
      screen.queryByText("字段发布后不能更改数据类型。"),
    ).not.toBeInTheDocument();
  });

  it("lets an administrator replace generated option keys and choose colors", () => {
    renderDesigner(draft(), objectApi());

    fireEvent.click(screen.getByRole("button", { name: "配置字段 最终评级" }));

    expect(screen.getByLabelText("选项键 gold")).toHaveValue("gold");
    expect(screen.getByLabelText("选项颜色 gold")).toBeInTheDocument();
  });

  it("reorders fields by keyboard and sends the resulting order with the draft version", async () => {
    const api = objectApi();
    renderDesigner(draft(), api);

    fireEvent.click(screen.getByRole("button", { name: "上移 最终评级" }));

    await waitFor(() =>
      expect(api.reorderFields).toHaveBeenCalledWith("northwind", "object-1", {
        expectedVersion: 4,
        fieldIds: ["field-rating", "field-name"],
      }),
    );
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
    expect(screen.getByRole("table", { name: "字段账本" })).toHaveTextContent(
      "customer_name",
    );
  });
});

describe("ObjectDesigner employee preview", () => {
  it("opens an explicit preview drawer for the narrow workbench", async () => {
    renderDesigner(draft(), objectApi());

    fireEvent.click(screen.getByRole("button", { name: "打开员工端预览" }));

    expect(
      await screen.findByRole("dialog", { name: "员工端预览" }),
    ).toBeInTheDocument();
  });

  it("hides a hidden field and drops the create action from the employee view", () => {
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

    fireEvent.click(screen.getByRole("radio", { name: "员工视角" }));
    const preview = screen.getByRole("region", { name: "权限预览" });

    expect(within(preview).getByText("客户名称")).toBeInTheDocument();
    expect(within(preview).queryByText("内部评分")).not.toBeInTheDocument();
    expect(
      within(preview).queryByRole("button", { name: "新建记录" }),
    ).not.toBeInTheDocument();
    expect(within(preview).getByText("我的客户资料")).toBeInTheDocument();
  });

  it("shows the administrator every field and the create action", () => {
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

    const preview = screen.getByRole("region", { name: "权限预览" });

    expect(within(preview).getByText("内部评分")).toBeInTheDocument();
    expect(
      within(preview).getByRole("button", { name: "新建记录" }),
    ).toBeInTheDocument();
  });
});
