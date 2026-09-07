import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { RecordForm } from "./record-form";

function schema(
  overrides: Partial<RuntimeObjectSchema> = {},
): RuntimeObjectSchema {
  return {
    publication: { number: 1, publishedAt: "2026-08-21T00:00:00.000Z" },
    object: {
      code: "customers",
      name: "客户资料",
      description: null,
      titleFieldKey: "name",
      icon: null,
      sortOrder: 10,
    },
    fields: [
      {
        id: "f-name",
        fieldKey: "name",
        label: "客户名称",
        type: "TEXT",
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
        access: "EDIT",
      },
      {
        id: "f-amount",
        fieldKey: "amount",
        label: "合同金额",
        type: "MONEY",
        required: false,
        defaultValue: null,
        validation: { scale: 2 },
        config: {},
        sortOrder: 2,
        isSystem: false,
        access: "EDIT",
      },
      {
        id: "f-rating",
        fieldKey: "rating",
        label: "客户评级",
        type: "SINGLE_SELECT",
        required: false,
        defaultValue: null,
        validation: {},
        config: { options: [{ key: "gold", label: "金牌", status: "ACTIVE" }] },
        sortOrder: 3,
        isSystem: false,
        access: "READ_ONLY",
      },
    ],
    defaultView: {
      code: "default",
      name: "默认视图",
      columnFieldKeys: ["name", "amount"],
      sort: { field: "updatedAt", direction: "desc" },
    },
    actions: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    },
    scopes: { read: "OWN", update: "OWN" },
    ...overrides,
  } as RuntimeObjectSchema;
}

const savedRecord = {
  id: "record-1",
  recordNo: "1",
  title: "百杰",
  ownerMemberId: "member-lin",
  values: { name: "百杰" },
  version: 4,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function recordApi(overrides: Partial<RecordApi> = {}): RecordApi {
  return {
    list: vi.fn(),
    create: vi.fn().mockResolvedValue(savedRecord),
    detail: vi.fn(),
    update: vi.fn().mockResolvedValue(savedRecord),
    remove: vi.fn(),
    listActivities: vi.fn(),
    createActivity: vi.fn(),
    export: vi.fn(),
    ...overrides,
  };
}

function renderForm(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const conflict = {
  code: "RECORD_VERSION_CONFLICT",
  message: "记录已被其他成员更新。",
  fieldErrors: {},
  requestId: "req_conflict",
  status: 409,
};

describe("RecordForm creating a record", () => {
  it("submits only the fields the member may edit", async () => {
    const api = recordApi();
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        api={api}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("客户名称"), {
      target: { value: "百杰" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建记录" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, , body] = vi.mocked(api.create).mock.calls[0];
    expect(body.values).toEqual({ name: "百杰" });
    expect(body.values).not.toHaveProperty("rating");
  });

  it("never renders an editable control for a read-only field", () => {
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        api={recordApi()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("客户评级")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByText("仅管理员可编辑").length).toBeGreaterThan(0);
  });

  it("reports a required field instead of sending an invalid payload", async () => {
    const api = recordApi();
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        api={api}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "创建记录" }));

    expect(await screen.findByText("请填写客户名称。")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("keeps an employee out of the owner control", () => {
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        api={recordApi()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("负责人")).not.toBeInTheDocument();
  });

  it("lets an administrator hand the record to another member", async () => {
    const api = recordApi();
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        api={api}
        canChooseOwner
        members={[
          { id: "member-lin", displayName: "林员工" },
          { id: "member-chen", displayName: "陈管理员" },
        ]}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("客户名称"), {
      target: { value: "百杰" },
    });
    fireEvent.mouseDown(screen.getByLabelText("负责人"));
    fireEvent.click(screen.getByTitle("林员工"));
    fireEvent.click(screen.getByRole("button", { name: "创建记录" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.create).mock.calls[0][2].ownerMemberId).toBe(
      "member-lin",
    );
  });
});

describe("RecordForm updating a record", () => {
  const existing = {
    ...savedRecord,
    version: 3,
    values: { name: "百杰", amount: "1200.00", rating: "gold" },
  };

  it("sends the version it was editing so a stale write is rejected", async () => {
    const api = recordApi();
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        record={existing}
        api={api}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("客户名称"), {
      target: { value: "百杰科技" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [, , recordId, body] = vi.mocked(api.update).mock.calls[0];
    expect(recordId).toBe("record-1");
    expect(body.version).toBe(3);
    expect(body.values).toEqual({ name: "百杰科技", amount: "1200.00" });
    expect(body.values).not.toHaveProperty("rating");
  });

  it("keeps the entered values and offers a reload on a version conflict", async () => {
    const api = recordApi({
      update: vi.fn().mockRejectedValue(conflict),
    });
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        record={existing}
        api={api}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("客户名称"), {
      target: { value: "百杰科技" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(
      await screen.findByRole("button", { name: "重新载入记录" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("客户名称")).toHaveValue("百杰科技");
  });

  it("shows a server field error against the field it belongs to", async () => {
    const api = recordApi({
      update: vi.fn().mockRejectedValue({
        code: "FIELD_INVALID",
        message: "字段值格式不正确。",
        fieldErrors: { amount: ["金额最多 2 位小数。"] },
        requestId: "req_invalid",
        status: 400,
      }),
    });
    renderForm(
      <RecordForm
        tenantCode="northwind"
        schema={schema()}
        record={existing}
        api={api}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("金额最多 2 位小数。")).toBeInTheDocument();
    expect(screen.getByLabelText("合同金额")).toHaveValue("1200.00");
  });
});
