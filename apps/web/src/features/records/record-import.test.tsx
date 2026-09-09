import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { RecordImportDrawer } from "./record-import";

const schema = {
  publication: { number: 1, publishedAt: "2026-08-21T00:00:00.000Z" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [
    {
      id: "f-name",
      fieldKey: "name",
      label: "姓名",
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
      id: "f-status",
      fieldKey: "lead_status",
      label: "线索状态",
      type: "SINGLE_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [{ key: "new", label: "待联系", status: "ACTIVE" }],
      },
      sortOrder: 2,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "f-owner",
      fieldKey: "owner",
      label: "跟进人",
      type: "MEMBER",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 3,
      isSystem: false,
      access: "EDIT",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["name"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "ALL", update: "ALL" },
} as RuntimeObjectSchema;

function recordApi(overrides: Partial<RecordApi> = {}): RecordApi {
  return {
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listActivities: vi.fn(),
    createActivity: vi.fn(),
    export: vi.fn(),
    batchUpdate: vi.fn(),
    importRows: vi.fn().mockResolvedValue({
      created: 1,
      failed: 1,
      items: [
        { rowNumber: 2, status: "CREATED" },
        {
          rowNumber: 3,
          status: "FAILED",
          error: { code: "FIELD_INVALID", message: "字段值无效。" },
        },
      ],
    }),
    ...overrides,
  };
}

function renderDrawer(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RecordImportDrawer", () => {
  it("maps CSV headers to writable fields and imports coerced values", async () => {
    const api = recordApi();
    const onCompleted = vi.fn();
    renderDrawer(
      <RecordImportDrawer
        tenantCode="northwind"
        schema={schema}
        api={api}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    const file = new File(
      ["姓名,线索状态,备注\n天际,待联系,忽略\n星云,坏状态,忽略\n"],
      "leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(screen.getByLabelText("选择 CSV 文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("2 行 · 3 列")).toBeInTheDocument();
    expect(screen.queryByText("跟进人")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入映射后的行" }));

    await waitFor(() =>
      expect(api.importRows).toHaveBeenCalledWith("northwind", "customers", {
        batchId: expect.any(String),
        rows: [
          {
            rowNumber: 2,
            values: { name: "天际", lead_status: "new" },
          },
          {
            rowNumber: 3,
            values: { name: "星云", lead_status: "坏状态" },
          },
        ],
      }),
    );
    expect(screen.getByText(/成功 1 行，失败 1 行/)).toBeInTheDocument();
    expect(screen.getByText("第 3 行：字段值无效。")).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /重试失败行/ }));
    await waitFor(() => expect(api.importRows).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.importRows).mock.calls;
    expect(calls[1][2].batchId).toBe(calls[0][2].batchId);
    expect(calls[1][2].rows).toEqual([
      { rowNumber: 3, values: { name: "星云", lead_status: "坏状态" } },
    ]);
  });
});
