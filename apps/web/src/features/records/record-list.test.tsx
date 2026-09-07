import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  window.localStorage.clear();
});

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
    {
      id: "field-phone",
      fieldKey: "phone",
      label: "手机号",
      type: "PHONE",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 3,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-tags",
      fieldKey: "tags",
      label: "客户标签",
      type: "MULTI_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [
          { key: "vip", label: "重点", color: "ORANGE" },
          { key: "nurture", label: "培育", color: "CYAN" },
        ],
      },
      sortOrder: 4,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-signed",
      fieldKey: "signed_on",
      label: "签约日",
      type: "DATE",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 5,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-score",
      fieldKey: "score",
      label: "评分",
      type: "NUMBER",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 6,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-active",
      fieldKey: "is_active",
      label: "已启用",
      type: "BOOLEAN",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 7,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-assignee",
      fieldKey: "assignee",
      label: "跟进人",
      type: "MEMBER",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 8,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-notes",
      fieldKey: "notes",
      label: "备注",
      type: "TEXTAREA",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 9,
      isSystem: false,
      access: "EDIT",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认列表",
    columnFieldKeys: ["name", "lead_status", "phone", "score"],
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
  options: {
    schema?: RuntimeObjectSchema;
    api?: RecordApi;
    page?: RecordPage;
    members?: { id: string; displayName: string }[];
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const api =
    options.api ??
    ({
      list: vi.fn().mockResolvedValue(options.page ?? page),
    } as unknown as RecordApi);

  return render(
    <QueryClientProvider client={client}>
      <RecordList
        tenantCode="northwind"
        schema={options.schema ?? schema}
        query={query}
        initialPage={options.page ?? page}
        members={options.members}
        api={api}
        navigate={navigate}
      />
    </QueryClientProvider>,
  );
}

describe("RecordList table sorting", () => {
  it("separates the current row sequence from the stable business number", () => {
    renderList(
      vi.fn(),
      { ...DEFAULT_RECORD_QUERY, page: 3 },
      {
        page: { ...page, page: 3, limit: 20, total: 41 },
      },
    );

    expect(
      screen.getByRole("columnheader", { name: "序号" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /业务编号/ }),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /天际科技/ });
    expect(within(row).getByText("41")).toBeInTheDocument();
    expect(within(row).getByText("8")).toBeInTheDocument();
  });

  it("sorts through the record-number column header and keeps the state in the URL", async () => {
    const navigate = vi.fn();
    renderList(navigate);

    fireEvent.click(screen.getByRole("columnheader", { name: /业务编号/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers?sort=recordNo&direction=asc",
      ),
    );
    expect(screen.queryByLabelText("排序字段")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("排序方向")).not.toBeInTheDocument();
  });

  it("sorts a published numeric column through the header and keeps the field key in the URL", async () => {
    const navigate = vi.fn();
    renderList(navigate);

    fireEvent.click(screen.getByRole("columnheader", { name: /评分/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers?sort=score&direction=asc",
      ),
    );
  });

  it("restores the published default after clearing a descending column sort", async () => {
    const navigate = vi.fn();
    renderList(navigate, {
      ...DEFAULT_RECORD_QUERY,
      sort: "recordNo",
      direction: "desc",
    });

    fireEvent.click(screen.getByRole("columnheader", { name: /业务编号/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers",
      ),
    );
  });

  it("keeps all three compact actions discoverable when delete is not permitted", () => {
    renderList(vi.fn());
    const table = screen.getByRole("table", { name: "客户记录" });

    expect(
      within(table).getByRole("button", { name: "查看 天际科技" }),
    ).not.toHaveTextContent("查看");
    expect(
      within(table).getByRole("button", { name: "编辑 天际科技" }),
    ).not.toHaveTextContent("编辑");
    expect(
      within(table).getByRole("button", { name: "删除 天际科技" }),
    ).toBeDisabled();
  });

  it("exposes direct edit and delete actions when the effective policy allows them", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      remove: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      api,
      schema: {
        ...schema,
        actions: { ...schema.actions, canDelete: true },
      },
    });

    fireEvent.click(
      within(screen.getByRole("table", { name: "客户记录" })).getByRole(
        "button",
        { name: "编辑 天际科技" },
      ),
    );
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers/record-1?mode=edit",
    );

    fireEvent.click(
      within(screen.getByRole("table", { name: "客户记录" })).getByRole(
        "button",
        { name: "删除 天际科技" },
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith(
        "northwind",
        "customers",
        "record-1",
        1,
      ),
    );
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

  it("opens batch edit for selected rows", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      batchUpdate: vi.fn(),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, { api });

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择 天际科技" }));
    fireEvent.click(await screen.findByRole("button", { name: "批量修改 1" }));

    expect(screen.getByText("批量修改 1 条")).toBeInTheDocument();
  });

  it("lets a member choose personal columns and exports those columns", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, { api });

    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示列 手机号" }));
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果" }));

    await waitFor(() =>
      expect(api.export).toHaveBeenCalledWith(
        "northwind",
        "customers",
        expect.objectContaining({
          columns: ["name", "lead_status", "score"],
        }),
      ),
    );
    expect(window.localStorage.getItem("crm.records.columns.northwind.customers")).toBe(
      JSON.stringify(["name", "lead_status", "score"]),
    );
  });

  it("exports the current list filter from the toolbar", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    renderList(
      navigate,
      { ...DEFAULT_RECORD_QUERY, search: "天际" },
      { api },
    );

    fireEvent.click(screen.getByRole("button", { name: "导出当前结果" }));

    await waitFor(() =>
      expect(api.export).toHaveBeenCalledWith("northwind", "customers", {
        search: "天际",
        ownerMemberId: undefined,
        filters: {},
        sort: DEFAULT_RECORD_QUERY.sort,
        direction: DEFAULT_RECORD_QUERY.direction,
        columns: ["name", "lead_status", "phone", "score"],
      }),
    );
  });

  it("exposes search and option filters from the published schema", async () => {
    const navigate = vi.fn();
    renderList(navigate);

    expect(screen.getByLabelText("搜索客户名称、手机号")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "按签约日筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按签约日快捷筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "按评分筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按已启用筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按跟进人筛选" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("按备注筛选")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按备注填充筛选" }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "按客户标签筛选" }),
    );
    fireEvent.click(await screen.findByText("重点"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/workspace/northwind/objects/customers?filters=%7B%22tags%22%3A%5B%22vip%22%5D%7D",
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

  it("renders a compact card list with the same record actions as the table", () => {
    const navigate = vi.fn();
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      members: [{ id: "member-1", displayName: "李明" }],
      page: {
        ...page,
        items: [
          {
            ...page.items[0],
            ownerMemberId: "member-1",
          },
        ],
      },
    });

    const cards = screen.getByRole("list", { name: "客户记录卡片" });
    expect(within(cards).getByText("天际科技")).toBeInTheDocument();
    expect(within(cards).getByText("8")).toBeInTheDocument();
    expect(within(cards).getByText("待联系")).toBeInTheDocument();
    expect(within(cards).getByText("李明")).toBeInTheDocument();
    fireEvent.click(within(cards).getByRole("button", { name: "查看 天际科技" }));
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers/record-1",
    );
  });
});
