import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  RecordPage,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { RecordList } from "./record-list";
import { DEFAULT_RECORD_QUERY, type RecordQuery } from "./record-query-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const schema = {
  publication: { number: 1, publishedAt: "2026-08-30T00:00:00.000Z" },
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
      access: "EDIT",
    },
    {
      id: "field-status",
      fieldKey: "lead_status",
      label: "线索状态",
      type: "SINGLE_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [
          { key: "new", label: "待联系", color: "BLUE" },
          { key: "following", label: "跟进中", color: "GREEN" },
        ],
      },
      sortOrder: 2,
      isSystem: false,
      access: "EDIT",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认列表",
    columnFieldKeys: ["name", "lead_status"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "ALL", update: "OWN" },
} satisfies RuntimeObjectSchema;

const page = {
  items: [
    {
      id: "record-1",
      recordNo: "8",
      title: "天际科技",
      values: { name: "天际科技", lead_status: "new" },
      ownerMemberId: null,
      version: 1,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
} as RecordPage;

function renderList(
  navigate: (path: string) => void,
  query: RecordQuery = DEFAULT_RECORD_QUERY,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const api = {
    list: vi.fn().mockResolvedValue(page),
  } as unknown as RecordApi;

  return render(
    <QueryClientProvider client={client}>
      <RecordList
        tenantCode="northwind"
        schema={schema}
        query={query}
        initialPage={page}
        api={api}
        navigate={navigate}
      />
    </QueryClientProvider>,
  );
}

describe("RecordList table sorting", () => {
  it("sorts through the record-number column header and keeps the state in the URL", async () => {
    const navigate = vi.fn();
    renderList(navigate);

    fireEvent.click(screen.getByRole("columnheader", { name: /编号/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers?sort=recordNo&direction=asc",
      ),
    );
    expect(screen.queryByLabelText("排序字段")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("排序方向")).not.toBeInTheDocument();
  });

  it("builds a colored multi-value filter from the published status field", async () => {
    const navigate = vi.fn();
    renderList(navigate);

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "按线索状态筛选" }),
    );
    fireEvent.click(await screen.findByText("跟进中"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers?filters=%7B%22lead_status%22%3A%5B%22following%22%5D%7D",
      ),
    );
  });

  it("keeps every selected status visible instead of collapsing selections", () => {
    renderList(vi.fn(), {
      ...DEFAULT_RECORD_QUERY,
      filters: { lead_status: ["new", "following"] },
    });

    const select = screen
      .getByRole("combobox", { name: "按线索状态筛选" })
      .closest(".ant-select");
    expect(select).not.toBeNull();
    const selected = within(select as HTMLElement);
    expect(selected.getAllByText("待联系").length).toBeGreaterThan(0);
    expect(selected.getAllByText("跟进中").length).toBeGreaterThan(0);
    expect(selected.queryByText(/^\+\s*1/)).not.toBeInTheDocument();
  });
});
