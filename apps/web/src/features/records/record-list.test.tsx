import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type {
  RecordPage,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { RecordList } from "./record-list";
import { DEFAULT_RECORD_QUERY, type RecordQuery } from "./record-query-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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
  scopes: { read: "ALL", update: "ALL" },
} satisfies RuntimeObjectSchema;

const page = {
  items: [
    {
      id: "record-1",
      recordNo: "8",
      inPublicPool: false,
      ownershipExpiresAt: null,
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
    currentMemberId?: string;
    canFilterByOwner?: boolean;
    poolConfig?: import("./record-pool-types").RecordPoolConfig;
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

  const rendered = render(
    <QueryClientProvider client={client}>
      <RecordList
        tenantCode="northwind"
        schema={options.schema ?? schema}
        query={query}
        initialPage={options.page ?? page}
        members={options.members}
        currentMemberId={options.currentMemberId}
        canFilterByOwner={options.canFilterByOwner}
        api={api}
        poolConfig={options.poolConfig}
        navigate={navigate}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

describe("RecordList batch deletion", () => {
  it("does not let an older list response restore deleted rows or totals", async () => {
    let finishOldRead!: (value: RecordPage) => void;
    const oldRead = new Promise<RecordPage>((resolve) => {
      finishOldRead = resolve;
    });
    const list = vi
      .fn()
      .mockReturnValueOnce(oldRead)
      .mockResolvedValue({ ...page, items: [], total: 0 });
    const api = {
      list,
      remove: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as RecordApi;
    const { client } = renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      api,
      schema: { ...schema, actions: { ...schema.actions, canDelete: true } },
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 天际科技" }));
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除 1 条" }));
    await screen.findByText("成功删除 1 条，失败 0 条，未处理 0 条");
    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: "选择 天际科技" }),
      ).not.toBeInTheDocument(),
    );
    await act(async () => {
      finishOldRead(page);
      await oldRead;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(
      client.getQueryData<RecordPage>([
        "workspace",
        "northwind",
        "records",
        "customers",
        DEFAULT_RECORD_QUERY,
      ])?.total,
    ).toBe(0);
    expect(
      screen.queryByRole("checkbox", { name: "选择 天际科技" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("共 0 条")).toBeInTheDocument();
  });

  it("does not lock the deletion panel when offline refresh would pause the query", async () => {
    const list = vi.fn().mockResolvedValue(page);
    const api = {
      list,
      remove: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as RecordApi;
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      api,
      schema: { ...schema, actions: { ...schema.actions, canDelete: true } },
    });
    await waitFor(() => expect(list).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "选择 天际科技" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    list.mockRejectedValue(new Error("offline"));
    onlineManager.setOnline(false);
    try {
      fireEvent.click(screen.getByRole("button", { name: "确认删除 1 条" }));
      await screen.findByText("成功删除 1 条，失败 0 条，未处理 0 条");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled(),
      );
      expect(
        screen.getByRole("button", { name: "重试刷新列表" }),
      ).toBeEnabled();
      expect(api.remove).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("allows delete-only access, asks before deletion, and moves off an emptied last page preserving filters", async () => {
    let deleted = false;
    const navigate = vi.fn();
    const lastPage = { ...page, page: 2, total: 21 };
    const api = {
      list: vi
        .fn()
        .mockImplementation(async () =>
          deleted ? { ...lastPage, items: [], total: 20 } : lastPage,
        ),
      remove: vi.fn().mockImplementation(async () => {
        deleted = true;
        return { accepted: true };
      }),
    } as unknown as RecordApi;
    renderList(
      navigate,
      {
        ...DEFAULT_RECORD_QUERY,
        page: 2,
        search: "天际",
        sort: "recordNo",
        direction: "asc",
      },
      {
        api,
        page: lastPage,
        schema: {
          ...schema,
          actions: { ...schema.actions, canUpdate: false, canDelete: true },
        },
      },
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "选择 天际科技" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除 1 条" }));
    await screen.findByText("成功删除 1 条，失败 0 条，未处理 0 条");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(api.remove).toHaveBeenCalledWith(
      "northwind",
      "customers",
      page.items[0].id,
      page.items[0].version,
    );
    const target = new URL(navigate.mock.calls.at(-1)![0], "http://localhost");
    expect(target.searchParams.get("page")).toBeNull();
    expect(target.searchParams.get("search")).toBe("天际");
    expect(target.searchParams.get("sort")).toBe("recordNo");
    expect(target.searchParams.get("direction")).toBe("asc");
  });

  it("does not offer batch deletion without delete permission", async () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      schema: { ...schema, actions: { ...schema.actions, canDelete: false } },
    });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "选择 天际科技" }),
    );
    expect(
      screen.queryByRole("button", { name: "批量删除" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /批量修改/ }),
    ).toBeInTheDocument();
  });
});

describe("RecordList query navigation", () => {
  it("filters unassigned owners and resets pagination while preserving the other query conditions", async () => {
    const navigate = vi.fn();
    renderList(
      navigate,
      {
        ...DEFAULT_RECORD_QUERY,
        page: 3,
        limit: 100,
        search: "客户",
        sort: "recordNo",
        direction: "asc",
        filters: { lead_status: ["new"] },
      },
      { canFilterByOwner: true },
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按负责人筛选" }));
    fireEvent.click(await screen.findByText("未指定负责人"));
    const target = new URL(navigate.mock.calls.at(-1)![0], "http://localhost");
    expect(target.searchParams.get("ownerMemberId")).toBe("unassigned");
    expect(target.searchParams.get("page")).toBeNull();
    expect(target.searchParams.get("limit")).toBe("100");
    expect(target.searchParams.get("search")).toBe("客户");
    expect(target.searchParams.get("sort")).toBe("recordNo");
    expect(target.searchParams.get("filters")).toBe('{"lead_status":["new"]}');
  });

  it.each([50, 100, 300, 500, 1000])(
    "lets users show %i records and resets the page while preserving filters",
    async (limit) => {
      const navigate = vi.fn();
      renderList(
        navigate,
        { ...DEFAULT_RECORD_QUERY, page: 2, search: "客户" },
        { page: { ...page, page: 2, total: 120 } },
      );
      fireEvent.mouseDown(
        screen.getAllByRole("combobox", { name: "每页条数" })[0],
      );
      fireEvent.click(await screen.findByText(`${limit} 条 / 页`));
      expect(navigate).toHaveBeenCalledWith(
        expect.stringContaining(`limit=${limit}`),
      );
      const target = navigate.mock.calls.at(-1)![0] as string;
      expect(target).not.toContain("page=2");
      expect(target).toContain("search=");
    },
  );
  it("shows the system owner in the table and cards without requiring a business field", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      canFilterByOwner: true,
      members: [{ id: "member-1", displayName: "林晨" }],
      page: {
        ...page,
        items: [{ ...page.items[0], ownerMemberId: "member-1" }],
      },
    });
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "负责人" }),
    ).toBeVisible();
    expect(within(table).getByText("林晨")).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "客户记录卡片" })).getByText(
        "林晨",
      ),
    ).toBeVisible();
  });

  it.each([
    [null, "未指定"],
    ["unknown-member", "其他成员"],
  ])(
    "shows owner %s as %s without exposing an identifier",
    (ownerMemberId, label) => {
      renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
        canFilterByOwner: true,
        page: { ...page, items: [{ ...page.items[0], ownerMemberId }] },
      });
      expect(within(screen.getByRole("table")).getByText(label!)).toBeVisible();
      expect(
        within(screen.getByRole("list", { name: "客户记录卡片" })).getByText(
          label!,
        ),
      ).toBeVisible();
      expect(screen.queryByText("unknown-member")).not.toBeInTheDocument();
    },
  );

  it("omits repetitive owner labels from an employee's own-record list", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      currentMemberId: "member-1",
      schema: { ...schema, scopes: { read: "OWN", update: "OWN" } },
      page: {
        ...page,
        items: [{ ...page.items[0], ownerMemberId: "member-1" }],
      },
    });
    expect(
      screen.queryByRole("columnheader", { name: "负责人" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "客户记录卡片" })).queryByText(
        "负责人",
      ),
    ).not.toBeInTheDocument();
  });

  it("remembers owner visibility separately from business fields and restores the default", async () => {
    const options = { canFilterByOwner: true, currentMemberId: "member-1" };
    const view = renderList(vi.fn(), DEFAULT_RECORD_QUERY, options);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示系统负责人" }));
    expect(
      screen.queryByRole("columnheader", { name: "负责人" }),
    ).not.toBeInTheDocument();
    const key = "crm.records.display.v2.northwind.member-1.customers";
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({
      ownerVisible: false,
    });
    view.unmount();
    const again = renderList(vi.fn(), DEFAULT_RECORD_QUERY, options);
    expect(
      screen.queryByRole("columnheader", { name: "负责人" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByRole("columnheader", { name: "负责人" })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({
      ownerVisible: true,
      columns: [],
      widths: {},
      density: "comfortable",
    });
    again.unmount();
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, options);
    expect(screen.getByRole("columnheader", { name: "负责人" })).toBeVisible();
    // The owner is a system column, never a business field in the column list.
    expect(
      window.localStorage.getItem("crm.records.columns.northwind.customers"),
    ).toBeNull();
  });
  it("reflects a new URL search without remounting the list", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const api = {
      list: vi.fn().mockResolvedValue(page),
    } as unknown as RecordApi;
    const view = (search: string) => (
      <QueryClientProvider client={client}>
        <RecordList
          tenantCode="northwind"
          schema={schema}
          query={{ ...DEFAULT_RECORD_QUERY, search }}
          initialPage={page}
          api={api}
          navigate={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(view("旧关键词"));
    rerender(view("新关键词"));
    expect(screen.getByRole("textbox", { name: /搜索/ })).toHaveValue(
      "新关键词",
    );
  });

  it("keeps a pending draft when other URL query props receive a same-value refresh", async () => {
    const navigate = vi.fn();
    const result = renderList(navigate);
    const input = screen.getByRole("textbox", { name: /搜索/ });
    fireEvent.change(input, { target: { value: "保留草稿" } });
    result.rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RecordList
          tenantCode="northwind"
          schema={schema}
          query={{ ...DEFAULT_RECORD_QUERY }}
          initialPage={page}
          api={
            { list: vi.fn().mockResolvedValue(page) } as unknown as RecordApi
          }
          navigate={navigate}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("textbox", { name: /搜索/ })).toHaveValue(
      "保留草稿",
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers?search=%E4%BF%9D%E7%95%99%E8%8D%89%E7%A8%BF",
    );
  });

  it("cancels pending search navigation on unmount", async () => {
    const navigate = vi.fn();
    const { unmount } = renderList(navigate);
    fireEvent.change(screen.getByRole("textbox", { name: /搜索/ }), {
      target: { value: "未提交查询" },
    });
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not navigate again after immediately submitting search", async () => {
    const navigate = vi.fn();
    renderList(navigate);
    const input = screen.getByRole("textbox", { name: /搜索/ });
    fireEvent.change(input, { target: { value: "立即查询" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a sort change with a pending search", async () => {
    const navigate = vi.fn();
    renderList(navigate);
    fireEvent.change(screen.getByRole("textbox", { name: /搜索/ }), {
      target: { value: "未提交查询" },
    });
    fireEvent.click(screen.getByRole("columnheader", { name: /业务编号/ }));
    expect(screen.getByRole("textbox", { name: /搜索/ })).toHaveValue("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith(
      "/workspace/northwind/objects/customers?sort=recordNo&direction=asc",
    );
  });
});

describe("RecordList table sorting", () => {
  it("offers card sort and pagination using the same URL query", () => {
    const navigate = vi.fn();
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      page: { ...page, total: 45 },
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "卡片排序字段" }));
    fireEvent.click(
      screen.getByText("业务编号", {
        selector: ".ant-select-item-option-content",
      }),
    );
    expect(navigate).toHaveBeenLastCalledWith(
      "/workspace/northwind/objects/customers?sort=recordNo",
    );
    fireEvent.click(screen.getAllByTitle("Next Page")[0]);
    expect(navigate).toHaveBeenLastCalledWith(
      "/workspace/northwind/objects/customers?page=2",
    );
  });

  it("allows owner assignment above 100 while keeping the field edit limit", async () => {
    const many = {
      ...page,
      limit: 300,
      total: 101,
      items: Array.from({ length: 101 }, (_, i) => ({
        ...page.items[0],
        id: `record-${i}`,
        title: `客户${i}`,
      })),
    };
    renderList(
      vi.fn(),
      { ...DEFAULT_RECORD_QUERY, limit: 300 },
      { page: many, canFilterByOwner: true },
    );
    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("checkbox")[0],
    );
    expect(
      screen.getByText(/批量修改每次最多 100 条，负责人分配每次最多 1000 条/),
    ).toBeInTheDocument();
    // Selection actions live in the footer's selection bar.
    const bulk = screen.getByRole("toolbar", { name: "批量操作" });
    expect(within(bulk).getByText("已选 101 条")).toBeInTheDocument();
    expect(
      within(bulk).getByRole("button", { name: /批量修改/ }),
    ).toBeDisabled();
    expect(
      within(bulk).getByRole("button", { name: /分配负责人/ }),
    ).toBeEnabled();
    fireEvent.click(within(bulk).getByRole("button", { name: /分配负责人/ }));
    expect(await screen.findByText("批量分配 101 条记录")).toBeInTheDocument();
  });

  it("shares card selection with the existing batch edit action", async () => {
    renderList(vi.fn());
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择卡片 天际科技" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /批量修改/ }));
    expect(screen.getByText("批量修改 1 条")).toBeInTheDocument();
  });
  it("recovers filtered empty results without changing sort or page size", () => {
    const navigate = vi.fn();
    renderList(
      navigate,
      {
        ...DEFAULT_RECORD_QUERY,
        search: "不存在",
        ownerMemberId: "member-1",
        filters: { lead_status: ["new"] },
        page: 3,
        sort: "recordNo",
        direction: "asc",
      },
      { page: { ...page, items: [], total: 0, page: 3 } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "清除条件" })[0]);
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers?sort=recordNo&direction=asc",
    );
  });

  it("does not offer filter recovery for a genuinely empty register", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      page: { ...page, items: [], total: 0 },
    });
    expect(
      screen.getAllByText("还没有记录，新建第一条。").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "清除条件" })).toBeNull();
  });

  it("shows API failure instead of empty results and retries the same query", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("服务暂不可用"))
      .mockResolvedValue(page);
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      api: { list } as unknown as RecordApi,
      page: { ...page, items: [], total: 0 },
    });
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(screen.queryByText("还没有记录，新建第一条。")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getAllByText("天际科技").length).toBeGreaterThan(0),
    );
    expect(list).toHaveBeenLastCalledWith(
      "northwind",
      "customers",
      DEFAULT_RECORD_QUERY,
    );
  });

  it("uses the page header for the owned title, description and create action", () => {
    const navigate = vi.fn();
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      schema: {
        ...schema,
        object: { ...schema.object, description: "管理客户关系" },
        scopes: { ...schema.scopes, read: "OWN" },
      },
    });
    const title = screen.getByRole("heading", { level: 1, name: "我的客户" });
    const header = title.closest("header")!;
    expect(within(header).getByText("管理客户关系")).toBeInTheDocument();
    fireEvent.click(within(header).getByRole("button", { name: "新建客户" }));
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers/new",
    );
  });

  it("keeps creation out of the page header when not permitted", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      schema: { ...schema, actions: { ...schema.actions, canCreate: false } },
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "客户" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建客户" })).toBeNull();
  });

  it("keeps the stable business number without a redundant row sequence", () => {
    renderList(
      vi.fn(),
      { ...DEFAULT_RECORD_QUERY, page: 3 },
      {
        page: { ...page, page: 3, limit: 20, total: 41 },
      },
    );

    expect(
      screen.queryByRole("columnheader", { name: "序号" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /业务编号/ }),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /天际科技/ });
    expect(within(row).queryByText("41")).not.toBeInTheDocument();
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

  it.each([
    { scope: "OWN", owner: "member-1", editable: true },
    { scope: "OWN", owner: "member-2", editable: false },
    { scope: "OWN", owner: null, editable: false },
    { scope: "OWN", owner: "member-1", missingMember: true, editable: false },
    { scope: "NONE", owner: "member-1", editable: false },
    { scope: "ALL", owner: "member-2", editable: true },
    { scope: "ALL", owner: null, pool: true, editable: false },
    { scope: "ALL", owner: null, pool: true, admin: true, editable: true },
    { scope: "ALL", owner: "member-1", cannotUpdate: true, editable: false },
  ] as const)(
    "applies $scope edit scope to $owner consistently in row actions and bulk selection ($editable)",
    async (scenario) => {
      const navigate = vi.fn();
      renderList(navigate, DEFAULT_RECORD_QUERY, {
        currentMemberId: "missingMember" in scenario ? undefined : "member-1",
        canFilterByOwner: "admin" in scenario,
        schema: {
          ...schema,
          actions: {
            ...schema.actions,
            canUpdate: !("cannotUpdate" in scenario),
          },
          scopes: { read: "ALL", update: scenario.scope },
        },
        page: {
          ...page,
          items: [
            {
              ...page.items[0],
              ownerMemberId: scenario.owner,
              inPublicPool: "pool" in scenario,
            },
          ],
        },
      });

      for (const label of ["选择 天际科技", "选择卡片 天际科技"]) {
        if ("cannotUpdate" in scenario) {
          expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
        } else if (scenario.editable) {
          expect(screen.getByLabelText(label)).toBeEnabled();
        } else {
          expect(screen.getByLabelText(label)).toBeDisabled();
        }
      }
      fireEvent.click(
        within(screen.getByRole("table", { name: "客户记录" })).getByRole(
          "button",
          { name: "更多操作 天际科技" },
        ),
      );
      const edit = await screen.findByRole("menuitem", { name: /^编辑/ });
      if (scenario.editable) {
        expect(edit).not.toHaveAttribute("aria-disabled", "true");
        fireEvent.click(edit);
        expect(navigate).toHaveBeenCalledWith(
          "/workspace/northwind/objects/customers/record-1?mode=edit",
        );
      } else {
        expect(edit).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(edit);
        expect(navigate).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps view, edit and delete discoverable behind one row menu when delete is not permitted", async () => {
    renderList(vi.fn());
    const table = screen.getByRole("table", { name: "客户记录" });

    // One compact trigger per row; the actions themselves are not pinned columns.
    expect(
      within(table).queryByRole("button", { name: "查看 天际科技" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(table).getByRole("button", { name: "更多操作 天际科技" }),
    );
    expect(await screen.findByRole("menuitem", { name: "查看" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: "删除（无删除权限）" }),
    ).toHaveAttribute("aria-disabled", "true");
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
        { name: "更多操作 天际科技" },
      ),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "编辑" }));
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers/record-1?mode=edit",
    );
  });

  it("deletes from the row menu only after an explicit confirmation", async () => {
    const api = {
      list: vi.fn().mockResolvedValue(page),
      remove: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as RecordApi;
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      api,
      schema: { ...schema, actions: { ...schema.actions, canDelete: true } },
    });

    fireEvent.click(
      within(screen.getByRole("table", { name: "客户记录" })).getByRole(
        "button",
        { name: "更多操作 天际科技" },
      ),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    expect(
      await screen.findByText("删除后业务列表不再显示，审计历史仍会保留。"),
    ).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
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

  it("opens mapped CSV import from the toolbar", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      importRows: vi.fn(),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, { api });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导入 Excel / CSV" }),
    );
    expect(
      await screen.findByLabelText("选择 Excel 或 CSV 文件"),
    ).toBeInTheDocument();
  });

  it.each(["选择卡片", "选择"])(
    "keeps %s batch count and request on the current page",
    async (label) => {
      const second = {
        ...page.items[0],
        id: "record-2",
        title: "第二页客户",
        version: 4,
      };
      const firstPage = { ...page, limit: 1, total: 2 };
      const secondPage = { ...firstPage, page: 2, items: [second] };
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const api = {
        list: vi
          .fn()
          .mockImplementation((_tenant, _object, query: RecordQuery) =>
            Promise.resolve(query.page === 2 ? secondPage : firstPage),
          ),
        batchUpdate: vi
          .fn()
          .mockResolvedValue({ updated: 1, failed: 0, items: [] }),
      } as unknown as RecordApi;
      function TwoPages() {
        const [query, setQuery] = useState(DEFAULT_RECORD_QUERY);
        return (
          <RecordList
            tenantCode="northwind"
            schema={schema}
            query={query}
            initialPage={query.page === 2 ? secondPage : firstPage}
            api={api}
            navigate={(path) =>
              setQuery({
                ...DEFAULT_RECORD_QUERY,
                page: Number(
                  new URL(path, "http://test").searchParams.get("page") ?? 1,
                ),
              })
            }
          />
        );
      }
      render(
        <QueryClientProvider client={client}>
          <TwoPages />
        </QueryClientProvider>,
      );
      fireEvent.click(
        await screen.findByRole("checkbox", { name: `${label} 天际科技` }),
      );
      // One pager in the footer serves the table and the cards.
      fireEvent.click(screen.getAllByTitle("2")[0]);
      fireEvent.click(
        await screen.findByRole("checkbox", { name: `${label} 第二页客户` }),
      );
      expect(screen.getByText("已选 1 条")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /批量修改/ }));
      expect(screen.getByText("批量修改 1 条")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: "批量修改 备注" }));
      fireEvent.change(screen.getByRole("textbox", { name: "备注" }), {
        target: { value: "当前页修改" },
      });
      fireEvent.click(screen.getByRole("button", { name: "应用到选中记录" }));
      await waitFor(() =>
        expect(api.batchUpdate).toHaveBeenCalledWith("northwind", "customers", {
          items: [{ recordId: "record-2", version: 4 }],
          values: { notes: "当前页修改" },
        }),
      );
    },
  );

  it("clears selection when an external filter URL changes even if the same record remains", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const api = {
      list: vi.fn().mockResolvedValue(page),
    } as unknown as RecordApi;
    const view = (query: RecordQuery) => (
      <QueryClientProvider client={client}>
        <RecordList
          tenantCode="northwind"
          schema={schema}
          query={query}
          initialPage={page}
          api={api}
          navigate={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(view(DEFAULT_RECORD_QUERY));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "选择卡片 天际科技" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /批量修改/ }));
    expect(screen.getByText("批量修改 1 条")).toBeInTheDocument();
    rerender(view({ ...DEFAULT_RECORD_QUERY, search: "天际" }));
    expect(screen.queryByText("批量修改 0 条")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "选择卡片 天际科技" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "选择 天际科技" }),
    ).not.toBeChecked();
    // With nothing selected the selection bar, and its batch actions, are gone.
    expect(screen.queryByRole("toolbar", { name: "批量操作" })).toBeNull();
  });

  it("opens batch edit for selected rows", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      batchUpdate: vi.fn(),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, { api });

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "选择 天际科技" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /批量修改/ }));

    expect(screen.getByText("批量修改 1 条")).toBeInTheDocument();
  });

  it("lets a member choose personal columns and exports those columns", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      api,
      currentMemberId: "member-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示列 手机号" }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出当前结果" }),
    );

    await waitFor(() =>
      expect(api.export).toHaveBeenCalledWith(
        "northwind",
        "customers",
        expect.objectContaining({
          columns: ["name", "lead_status", "score"],
        }),
      ),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "crm.records.display.v2.northwind.member-1.customers",
        )!,
      ),
    ).toMatchObject({ columns: ["name", "lead_status", "score"] });
  });

  it("exports the current list filter from the toolbar", async () => {
    const navigate = vi.fn();
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    renderList(navigate, { ...DEFAULT_RECORD_QUERY, search: "天际" }, { api });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出当前结果" }),
    );

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
    // Every other filterable field is one condition away in the 筛选 popover.
    await addCondition("签约日");
    expect(
      screen.getByRole("group", { name: "按签约日筛选" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "按签约日快捷筛选" }),
    ).toBeInTheDocument();
    await addCondition("评分");
    expect(
      screen.getByRole("group", { name: "按评分筛选" }),
    ).toBeInTheDocument();
    await addCondition("已启用");
    expect(
      screen.getByRole("combobox", { name: "按已启用筛选" }),
    ).toBeInTheDocument();
    await addCondition("跟进人");
    expect(
      screen.getByRole("combobox", { name: "按跟进人筛选" }),
    ).toBeInTheDocument();
    await addCondition("备注");
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
    // A card carries the same ⋯ menu as its table row.
    fireEvent.click(
      within(cards).getByRole("button", { name: "更多操作 天际科技" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "查看" }));
    expect(navigate).toHaveBeenCalledWith(
      "/workspace/northwind/objects/customers/record-1",
    );
  });
});

it("switches to public pool preserving filters and resetting owner and page", () => {
  const navigate = vi.fn();
  renderList(
    navigate,
    {
      ...DEFAULT_RECORD_QUERY,
      page: 3,
      ownerMemberId: "member-1",
      search: "测试",
      filters: { lead_status: ["new"] },
    },
    { poolConfig: { enabled: true, ownershipTtlHours: null, version: 1 } },
  );
  // The record scope is a single-choice control, so it is a radio group rather than tabs.
  expect(
    screen.getByRole("radiogroup", { name: "记录范围" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "公共池" }));
  const url = new URL(navigate.mock.calls[0][0], "http://localhost");
  expect(url.searchParams.get("scope")).toBe("pool");
  expect(url.searchParams.has("page")).toBe(false);
  expect(url.searchParams.has("ownerMemberId")).toBe(false);
  expect(url.searchParams.get("search")).toBe("测试");
  expect(url.searchParams.get("filters")).toContain("new");
});
it("keeps employee public pool rows read-only and omits all tab for OWN readers", () => {
  renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
    schema: { ...schema, scopes: { read: "OWN", update: "OWN" } },
    poolConfig: { enabled: true, ownershipTtlHours: null, version: 1 },
    page: {
      ...page,
      items: [
        { ...page.items[0], inPublicPool: true, ownershipExpiresAt: null },
      ],
    },
  });
  expect(
    screen.queryByRole("radio", { name: "全部记录" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "公共池" })).toBeInTheDocument();
  // The row menu explains why editing is unavailable.
  fireEvent.click(
    within(screen.getByRole("table", { name: "客户记录" })).getByRole(
      "button",
      { name: "更多操作 天际科技" },
    ),
  );
  expect(
    screen.getByRole("menuitem", { name: "编辑（领取后可编辑）" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(
    screen.getByRole("checkbox", { name: "选择 天际科技" }),
  ).toBeDisabled();
  expect(
    screen.getAllByRole("button", { name: "领取 天际科技" }).length,
  ).toBeGreaterThan(0);
});

it("uses the business table title in the public pool for OWN readers", () => {
  renderList(
    vi.fn(),
    { ...DEFAULT_RECORD_QUERY, scope: "pool" },
    {
      schema: { ...schema, scopes: { read: "OWN", update: "OWN" } },
      poolConfig: { enabled: true, ownershipTtlHours: null, version: 1 },
    },
  );
  expect(screen.getByRole("heading", { name: "客户" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "我的客户" }),
  ).not.toBeInTheDocument();
});

it("does not refetch the current public pool route after its config is disabled", () => {
  const api = {
    list: vi.fn().mockRejectedValue(new Error("PUBLIC_POOL_DISABLED")),
  } as unknown as RecordApi;
  renderList(
    vi.fn(),
    { ...DEFAULT_RECORD_QUERY, scope: "pool" },
    {
      api,
      poolConfig: { enabled: false, ownershipTtlHours: null, version: 2 },
    },
  );
  expect(api.list).not.toHaveBeenCalled();
});

it("explains an empty pool without implying the business table has no records", () => {
  renderList(
    vi.fn(),
    { ...DEFAULT_RECORD_QUERY, scope: "pool" },
    {
      poolConfig: { enabled: true, ownershipTtlHours: null, version: 1 },
      page: { ...page, items: [], total: 0 },
    },
  );
  expect(
    screen.getAllByText("公共池暂无记录，可由负责人释放或管理员移入").length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByText("还没有记录，新建第一条。"),
  ).not.toBeInTheDocument();
});

it("navigates staged views with visible counts and preserves legacy and all access", () => {
  const navigate = vi.fn();
  renderList(
    navigate,
    { ...DEFAULT_RECORD_QUERY, page: 3, ownerMemberId: "unassigned" },
    {
      canFilterByOwner: true,
      poolConfig: {
        enabled: true,
        lifecycleEnabled: true,
        ownershipTtlHours: null,
        version: 1,
      },
      page: {
        ...page,
        poolCounts: {
          LEAD_POOL: 2,
          CUSTOMER_POOL: 1,
          PENDING_CONTACT: 3,
          FOLLOWING: 4,
          PROTECTED: 5,
          LEGACY: 9,
        },
      },
    },
  );
  fireEvent.click(screen.getByRole("radio", { name: "初始公共池 2" }));
  const publicQuery = new URL(navigate.mock.calls.at(-1)![0], "http://test")
    .searchParams;
  expect(publicQuery.get("poolStage")).toBe("LEAD_POOL");
  expect(publicQuery.has("scope")).toBe(false);
  expect(publicQuery.has("ownerMemberId")).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "跟进中 4" }));
  expect(
    new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams.get(
      "poolStage",
    ),
  ).toBe("FOLLOWING");
  fireEvent.click(screen.getByRole("radio", { name: "旧记录 9" }));
  expect(
    new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams.get(
      "poolStage",
    ),
  ).toBe("LEGACY");
  expect(screen.getByRole("radio", { name: "全部记录" })).toBeInTheDocument();
});

it("does not refetch a staged public view after the pool is closed", () => {
  const api = {
    list: vi.fn().mockRejectedValue(new Error("PUBLIC_POOL_DISABLED")),
  } as unknown as RecordApi;
  renderList(
    vi.fn(),
    { ...DEFAULT_RECORD_QUERY, poolStage: "LEAD_POOL" },
    {
      api,
      poolConfig: {
        enabled: false,
        lifecycleEnabled: true,
        ownershipTtlHours: null,
        version: 2,
      },
    },
  );
  expect(api.list).not.toHaveBeenCalled();
});

it("defaults an employee's private stage to their own records even with ALL read access", () => {
  const navigate = vi.fn();
  renderList(navigate, DEFAULT_RECORD_QUERY, {
    poolConfig: {
      enabled: true,
      lifecycleEnabled: true,
      ownershipTtlHours: null,
      version: 1,
    },
  });
  fireEvent.click(screen.getByRole("radio", { name: "跟进中" }));
  expect(
    new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams.get(
      "scope",
    ),
  ).toBe("mine");
});

it("never includes system owner unassigned sentinel in a business MEMBER filter", async () => {
  renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
    canFilterByOwner: true,
    members: [{ id: "member-1", displayName: "林晨" }],
    schema: {
      ...schema,
      fields: [
        ...schema.fields,
        {
          ...schema.fields[0],
          id: "collaborator",
          fieldKey: "collaborator",
          label: "协作人",
          type: "MEMBER",
        },
      ],
    },
  });
  await addCondition("协作人");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "按协作人筛选" }));
  expect(await screen.findByText("林晨")).toBeInTheDocument();
  expect(screen.queryByText("未指定负责人")).not.toBeInTheDocument();
});

/** Opens the 筛选 popover (once) and adds a condition row for one field. */
async function addCondition(label: string) {
  if (!screen.queryByRole("group", { name: "筛选条件" })) {
    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
  }
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: "添加条件" }),
  );
  const options = await screen.findAllByText(label, {
    selector: ".ant-select-item-option-content",
  });
  fireEvent.click(options.at(-1)!);
}

describe("RecordList personal display settings", () => {
  const key = "crm.records.display.v2.northwind.member-1.customers";
  const headerTexts = () =>
    within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim() ?? "");

  it("orders system columns among fields while selection and actions stay at the ends", async () => {
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      api,
      currentMemberId: "member-1",
      canFilterByOwner: true,
    });
    expect(headerTexts().slice(1)).toEqual([
      "业务编号",
      "客户名称",
      "线索状态",
      "手机号",
      "评分",
      "负责人",
      "最近更新",
      "操作",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 最近更新" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 最近更新" }));
    fireEvent.click(screen.getByRole("button", { name: "下移 业务编号" }));
    expect(headerTexts().slice(1)).toEqual([
      "客户名称",
      "业务编号",
      "线索状态",
      "手机号",
      "最近更新",
      "评分",
      "负责人",
      "操作",
    ]);
    // The selection checkbox is still the first header cell.
    expect(
      within(screen.getAllByRole("columnheader")[0]).getByRole("checkbox"),
    ).toBeInTheDocument();

    const saved = JSON.parse(window.localStorage.getItem(key)!);
    expect(saved.order).toEqual([
      "name",
      "system:recordNo",
      "lead_status",
      "phone",
      "system:updatedAt",
      "score",
      "system:systemOwner",
    ]);
    expect(saved.columns).toEqual(["name", "lead_status", "phone", "score"]);

    // An export only ever receives business fields.
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出当前结果" }),
    );
    await waitFor(() =>
      expect(api.export).toHaveBeenCalledWith(
        "northwind",
        "customers",
        expect.objectContaining({
          columns: ["name", "lead_status", "phone", "score"],
        }),
      ),
    );
  });

  it("keeps historical field keys after moving a system column, reloading and exporting", async () => {
    const historicalSchema: RuntimeObjectSchema = {
      ...schema,
      fields: [
        ...schema.fields,
        {
          ...schema.fields[0],
          id: "field-close-date",
          fieldKey: "closeDate",
          label: "预计成交日",
          type: "DATE",
          required: false,
        },
      ],
      defaultView: {
        ...schema.defaultView,
        columnFieldKeys: ["name", "closeDate"],
      },
    };
    const api = {
      list: vi.fn().mockResolvedValue(page),
      export: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecordApi;
    const options = {
      api,
      schema: historicalSchema,
      currentMemberId: "member-1",
    };
    const view = renderList(vi.fn(), DEFAULT_RECORD_QUERY, options);
    expect(headerTexts()).toContain("预计成交日");
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 最近更新" }));
    const beforeReload = headerTexts();
    view.unmount();
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, options);
    expect(headerTexts()).toEqual(beforeReload);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出当前结果" }),
    );
    await waitFor(() =>
      expect(api.export).toHaveBeenCalledWith(
        "northwind",
        "customers",
        expect.objectContaining({ columns: ["name", "closeDate"] }),
      ),
    );
  });

  it("moves a column from the keyboard on its drag handle", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, { currentMemberId: "member-1" });
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const handle = screen.getByRole("button", {
      name: "拖动调整 最近更新 的位置",
    });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(headerTexts().slice(-3)).toEqual(["最近更新", "负责人", "操作"]);
    expect(
      screen.getByRole("button", { name: "拖动调整 最近更新 的位置" }),
    ).toHaveFocus();
  });

  it("applies a personal header colour to this table, keeps it and resets it", () => {
    const view = renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      currentMemberId: "member-1",
    });
    const panel = () => screen.getByRole("region", { name: "客户记录表" });
    expect(panel()).not.toHaveAttribute("data-header-tone");
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(
      screen.getByText(/个人显示偏好.*无需发布，不改变公司默认视图/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "浅青" }));
    expect(panel()).toHaveAttribute("data-header-tone", "cyan");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({
      headerTone: "cyan",
    });
    // Other tables of the same member keep their own colour.
    expect(
      window.localStorage.getItem(
        "crm.records.display.v2.northwind.member-1.deals",
      ),
    ).toBeNull();
    view.unmount();

    renderList(vi.fn(), DEFAULT_RECORD_QUERY, { currentMemberId: "member-1" });
    expect(panel()).toHaveAttribute("data-header-tone", "cyan");
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(panel()).not.toHaveAttribute("data-header-tone");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({
      headerTone: "default",
      order: [],
      columns: [],
    });
  });

  it("never brings back a field or system column the member may not see through a saved order", () => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        columns: ["margin", "name", "phone"],
        order: [
          "system:systemOwner",
          "margin",
          "system:updatedAt",
          "phone",
          "name",
        ],
        widths: {},
        density: "comfortable",
        columnDensity: {},
        ownerVisible: true,
      }),
    );
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      currentMemberId: "member-1",
      schema: {
        ...schema,
        fields: [
          ...schema.fields,
          {
            id: "field-margin",
            fieldKey: "margin",
            label: "毛利",
            type: "MONEY",
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 99,
            isSystem: false,
            access: "HIDDEN",
          },
        ],
        scopes: { read: "OWN", update: "OWN" },
      },
      poolConfig: { enabled: true, ownershipTtlHours: null, version: 1 },
    });
    // Only the member's own records: no owner column; the pool keeps its
    // column. Columns the saved order never mentioned take their usual place.
    expect(headerTexts().slice(1)).toEqual([
      "业务编号",
      "最近更新",
      "客户名称",
      "手机号",
      "归属状态",
      "操作",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(screen.queryByText("毛利")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "显示系统负责人" }),
    ).not.toBeInTheDocument();
    // Pool status is always shown with the pool on: listed, not switchable.
    const columnsList = screen.getByRole("list", { name: "显示的列与顺序" });
    expect(within(columnsList).getByText("归属状态")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "显示列 归属状态" }),
    ).not.toBeInTheDocument();
  });
});

describe("GROUP record scope controls", () => {
  const groupSchema: RuntimeObjectSchema = {
    ...schema,
    scopes: { read: "GROUP", update: "OWN" },
  };
  const legacyPool = { enabled: true, ownershipTtlHours: null, version: 1 };

  it("selects a teammate by name, resets paging and keeps the other filters", async () => {
    const navigate = vi.fn();
    renderList(navigate, { ...DEFAULT_RECORD_QUERY, page: 3, search: "客户", filters: { lead_status: ["new"] } }, {
      schema: groupSchema, currentMemberId: "leader",
      members: [{ id: "leader", displayName: "刘情" }, { id: "teammate", displayName: "钱宇" }],
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按小组成员筛选" }));
    fireEvent.click(await screen.findByText("钱宇"));
    const params = new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams;
    expect(params.get("ownerMemberId")).toBe("teammate");
    expect(params.get("scope")).toBe("group");
    expect(params.has("page")).toBe(false);
    expect(params.get("search")).toBe("客户");
    expect(params.get("filters")).toContain("new");
    expect(screen.queryByText("未指定负责人")).not.toBeInTheDocument();
  });

  it.each([
    ["刘情", "mine"],
    ["全部本组", "group"],
  ])("switches a teammate selection to %s without retaining the previous owner", async (label, scope) => {
    const navigate = vi.fn();
    renderList(navigate, { ...DEFAULT_RECORD_QUERY, scope: "group", ownerMemberId: "teammate", page: 3 }, {
      schema: groupSchema, currentMemberId: "leader",
      members: [{ id: "leader", displayName: "刘情" }, { id: "teammate", displayName: "钱宇" }],
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按小组成员筛选" }));
    fireEvent.click(await screen.findByText(label, { selector: label === "全部本组" ? ".ant-select-item-option-content" : ".ant-select-item-option-content *" }));
    const params = new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams;
    expect(params.get("scope")).toBe(scope);
    expect(params.has("ownerMemberId")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("keeps a selected teammate across private stages but clears the owner in public pools", () => {
    const navigate = vi.fn();
    renderList(navigate, { ...DEFAULT_RECORD_QUERY, scope: "group", ownerMemberId: "teammate", page: 3 }, {
      schema: groupSchema, currentMemberId: "leader",
      poolConfig: { ...legacyPool, lifecycleEnabled: true },
      members: [{ id: "leader", displayName: "刘情" }, { id: "teammate", displayName: "钱宇" }],
    });
    fireEvent.click(screen.getByRole("radio", { name: "跟进中" }));
    let params = new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams;
    expect(params.get("ownerMemberId")).toBe("teammate");
    expect(params.get("scope")).toBe("group");
    expect(params.get("poolStage")).toBe("FOLLOWING");
    fireEvent.click(screen.getByRole("radio", { name: "初始公共池" }));
    params = new URL(navigate.mock.calls.at(-1)![0], "http://test").searchParams;
    expect(params.has("ownerMemberId")).toBe(false);
    expect(params.get("scope")).toBe("mine");
    expect(params.get("poolStage")).toBe("LEAD_POOL");
  });

  it("hides the member picker in public pool views", () => {
    renderList(vi.fn(), { ...DEFAULT_RECORD_QUERY, poolStage: "LEAD_POOL" }, {
      schema: groupSchema, currentMemberId: "leader",
      members: [{ id: "leader", displayName: "刘情" }],
      poolConfig: { ...legacyPool, lifecycleEnabled: true },
    });
    expect(screen.queryByRole("combobox", { name: "按小组成员筛选" })).not.toBeInTheDocument();
  });

  it("shows the authorized teammate name on GROUP records without admin owner controls", () => {
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      schema: groupSchema,
      page: { ...page, items: [{ ...page.items[0], ownerMemberId: "teammate" }] },
      members: [{ id: "teammate", displayName: "钱宇" }],
      currentMemberId: "leader",
      canFilterByOwner: false,
    });
    expect(screen.getAllByText("钱宇").length).toBeGreaterThan(0);
    expect(screen.queryByText("其他成员")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "按负责人筛选" }),
    ).not.toBeInTheDocument();
  });

  it("defaults to own records and preserves explicit group navigation", async () => {
    const list = vi.fn().mockResolvedValue(page);
    renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
      schema: groupSchema,
      poolConfig: legacyPool,
      api: { list } as unknown as RecordApi,
    });
    expect(screen.getByRole("radio", { name: "我的记录" })).toBeChecked();
    expect(
      screen.queryByRole("radio", { name: "全部记录" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        "northwind",
        "customers",
        { ...DEFAULT_RECORD_QUERY, scope: "mine" },
      ),
    );
  });

  it("returns from the public pool to 本组记录 without sending an elevated scope", () => {
    const navigate = vi.fn();
    renderList(
      navigate,
      {
        ...DEFAULT_RECORD_QUERY,
        scope: "pool",
        page: 3,
        ownerMemberId: "member-2",
        search: "测试",
        filters: { lead_status: ["new"] },
      },
      { schema: groupSchema, poolConfig: legacyPool },
    );
    fireEvent.click(screen.getByRole("radio", { name: "本组记录" }));
    const params = new URL(navigate.mock.calls.at(-1)![0], "http://test")
      .searchParams;
    expect(params.get("scope")).toBe("group");
    expect(params.has("page")).toBe(false);
    expect(params.has("ownerMemberId")).toBe(false);
    expect(params.get("search")).toBe("测试");
    expect(params.get("filters")).toContain("new");
  });

  it("keeps the default own-owner selection across private lifecycle stages", async () => {
    const navigate = vi.fn();
    const groupPage = {
      ...page,
      poolCounts: {
        LEAD_POOL: 2,
        CUSTOMER_POOL: 1,
        PENDING_CONTACT: 3,
        FOLLOWING: 4,
        PROTECTED: 5,
        LEGACY: 9,
      },
    };
    const list = vi.fn().mockResolvedValue(groupPage);
    renderList(navigate, DEFAULT_RECORD_QUERY, {
      schema: groupSchema,
      poolConfig: { ...legacyPool, lifecycleEnabled: true },
      page: groupPage,
      api: { list } as unknown as RecordApi,
    });
    expect(screen.getByRole("radio", { name: "全部可见记录" })).toBeChecked();
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        "northwind",
        "customers",
        { ...DEFAULT_RECORD_QUERY, scope: "mine" },
      ),
    );
    for (const [label, stage] of [
      ["待联系 3", "PENDING_CONTACT"],
      ["跟进中 4", "FOLLOWING"],
      ["受保护 5", "PROTECTED"],
    ]) {
      fireEvent.click(screen.getByRole("radio", { name: label }));
      const params = new URL(navigate.mock.calls.at(-1)![0], "http://test")
        .searchParams;
      expect(params.get("poolStage")).toBe(stage);
      expect(params.get("scope")).toBe("mine");
    }
  });
});

it("offers only common query fields and disables search when none are searchable", async () => {
  renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
    schema: {
      ...schema,
      scopes: { read: "GROUP", update: "OWN" },
      queryFieldKeys: [],
      groupFieldAccess: {
        name: "READ_ONLY",
        lead_status: "HIDDEN",
        phone: "HIDDEN",
        score: "HIDDEN",
      },
    },
  });
  expect(screen.getByRole("textbox", { name: /搜索/ })).toBeDisabled();
  expect(
    screen.queryByRole("combobox", { name: "按线索状态筛选" }),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("columnheader", { name: "手机号" })
      .querySelector(".ant-table-column-sorters"),
  ).toBeNull();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "卡片排序字段" }));
  expect(
    screen.queryByText("手机号", {
      selector: ".ant-select-item-option-content",
    }),
  ).not.toBeInTheDocument();
});

it("renders hidden cells per row while allowing an explicitly editable teammate row", async () => {
  const mixed = {
    ...page,
    total: 2,
    items: [
      {
        ...page.items[0],
        id: "own",
        ownerMemberId: "leader",
        title: "本人客户",
        values: { name: "本人客户", phone: "13800138000" },
        fieldAccess: { name: "EDIT", phone: "EDIT" },
        canEditFields: true,
      },
      {
        ...page.items[0],
        id: "team",
        ownerMemberId: "teammate",
        title: "组员客户",
        values: { name: "组员客户", phone: "13900139000" },
        fieldAccess: { name: "EDIT", phone: "HIDDEN" },
        canEditFields: true,
      },
    ],
  } as RecordPage;
  renderList(vi.fn(), DEFAULT_RECORD_QUERY, {
    page: mixed,
    currentMemberId: "leader",
    schema: {
      ...schema,
      scopes: { read: "GROUP", update: "OWN" },
      groupFieldAccess: { name: "EDIT", phone: "HIDDEN" },
    },
  });
  expect(screen.getAllByText("13800138000").length).toBeGreaterThan(0);
  expect(screen.queryByText("13900139000")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole("button", { name: "更多操作 组员客户" })[0],
  );
  expect(await screen.findByRole("menuitem", { name: "编辑" })).not.toHaveClass(
    "ant-dropdown-menu-item-disabled",
  );
});
