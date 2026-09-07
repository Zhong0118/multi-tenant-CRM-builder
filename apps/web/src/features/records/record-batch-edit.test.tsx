import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import { RecordBatchEditDrawer } from "./record-batch-edit";
import type { RecordApi } from "./record-api";

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
      id: "f-status",
      fieldKey: "lead_status",
      label: "线索状态",
      type: "SINGLE_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [{ key: "following", label: "跟进中", status: "ACTIVE" }],
      },
      sortOrder: 1,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "f-secret",
      fieldKey: "secret",
      label: "内部备注",
      type: "TEXT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 2,
      isSystem: false,
      access: "HIDDEN",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["lead_status"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: { canCreate: true, canRead: true, canUpdate: true, canDelete: false },
  scopes: { read: "ALL", update: "ALL" },
} as RuntimeObjectSchema;

const records = [
  {
    id: "record-1",
    recordNo: "1",
    title: "天际科技",
    ownerMemberId: "member-1",
    values: { lead_status: "new" },
    version: 3,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  },
  {
    id: "record-2",
    recordNo: "2",
    title: "星云",
    ownerMemberId: "member-1",
    values: { lead_status: "new" },
    version: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  },
] as RecordSummary[];

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
    importRows: vi.fn(),
    batchUpdate: vi.fn().mockResolvedValue({
      updated: 1,
      failed: 1,
      items: [
        { recordId: "record-1", status: "UPDATED", record: records[0] },
        {
          recordId: "record-2",
          status: "FAILED",
          error: { code: "RECORD_VERSION_CONFLICT", message: "记录已被其他人修改。" },
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

describe("RecordBatchEditDrawer", () => {
  it("sends only selected editable fields for the chosen records", async () => {
    const api = recordApi();
    const onCompleted = vi.fn();
    renderDrawer(
      <RecordBatchEditDrawer
        tenantCode="northwind"
        schema={schema}
        records={records}
        api={api}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "批量修改 线索状态" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "线索状态" }));
    fireEvent.click(await screen.findByTitle("跟进中"));
    fireEvent.click(screen.getByRole("button", { name: "应用到选中记录" }));

    await waitFor(() =>
      expect(api.batchUpdate).toHaveBeenCalledWith("northwind", "customers", {
        items: [
          { recordId: "record-1", version: 3 },
          { recordId: "record-2", version: 1 },
        ],
        values: { lead_status: "following" },
      }),
    );
    expect(screen.getByText(/成功 1 条，失败 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/星云：记录已被其他人修改/)).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(screen.queryByText("内部备注")).not.toBeInTheDocument();
  });
});
