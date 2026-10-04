import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import Link from "next/link";
import { RecordWorkspace, type RecordWorkspaceProps } from "./record-workspace";
import type { RecordSummary } from "@/features/objects/object-types";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./record-list", () => ({ RecordList: () => <div>列表<Link href="/workspace/northwind/objects/customers/record-a?page=2">客户 A 链接</Link></div> }));
vi.mock("./record-detail-drawer", () => ({
  RecordDetailDrawer: ({
    record,
    initialEditing,
    followUpId,
    onClose,
    onChanged,
  }: {
    record: RecordSummary;
    initialEditing: boolean;
    followUpId?: string;
    onClose: () => void;
    onChanged: (record: RecordSummary | null) => void;
  }) => (
    <div role="dialog">
      <span>{record.title}</span>
      <span>{initialEditing ? "编辑模式" : "查看模式"}</span>
      {followUpId && <span>定位跟进：{followUpId}</span>}
      <button onClick={onClose}>关闭</button>
      <button onClick={() => onChanged(null)}>删除</button>
      <button
        onClick={() =>
          onChanged({ ...record, title: "已保存", version: record.version + 1 })
        }
      >
        保存
      </button>
    </div>
  ),
}));
const record: RecordSummary = {
  id: "record-a",
  recordNo: "1",
  title: "客户 A",
  version: 1,
  values: { name: "客户 A" },
  ownerMemberId: null,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};
const props: RecordWorkspaceProps = {
  tenantCode: "northwind",
  schema: {
    publication: { number: 1, publishedAt: "2026-09-09T00:00:00.000Z" },
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
    ],
    defaultView: {
      code: "default",
      name: "默认列表",
      columnFieldKeys: ["name"],
      sort: { field: "updatedAt", direction: "desc" },
    },
    actions: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
    scopes: { read: "ALL", update: "ALL" },
  },
  query: { ...DEFAULT_RECORD_QUERY, search: "客户", page: 2 },
  initialPage: { items: [], total: 0, page: 2, limit: 20 },
  members: [],
  isAdmin: true,
};

function render(ui: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe("record workspace navigation", () => {
  it("restores focus to the retained record link on ordinary list close", async () => {
    render(<RecordWorkspace {...props} openRecord={record} />);
    vi.spyOn(screen.getByRole("link", { name: "客户 A 链接" }), "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "客户 A 链接" })).toHaveFocus());
  });
  it.each(["关闭", "删除"])("%s returns to the exact validated source", async (action) => {
    render(<RecordWorkspace {...props} openRecord={record} returnTo="/workspace/northwind/follow-ups?status=DONE&page=3" />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("/workspace/northwind/follow-ups?status=DONE&page=3"));
  });
  it("deletion rejects an unsafe source and preserves the exact current list fallback", async () => {
    render(<RecordWorkspace {...props} openRecord={record} returnTo="/workspace/other" />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("/workspace/northwind/objects/customers?page=2&search=%E5%AE%A2%E6%88%B7"));
  });
  it("record changes refresh inactive record-list caches before return", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let title = "old";
    const key = ["workspace", "northwind", "records", "customers"];
    await client.fetchQuery({ queryKey: key, queryFn: async () => title });
    const view = render(<RecordWorkspace {...props} openRecord={record} />, client);
    title = "new";
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(client.getQueryData(key)).toBe("new"));
    view.unmount();
    expect(client.getQueryData(key)).toBe("new");
    client.clear();
  });
  it("record changes refresh all tenant record lists and related task caches", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let title = "old";
    const keys = [
      ["workspace", "northwind", "records", "customers"],
      ["workspace", "northwind", "records", "action-created-object"],
      ["workspace", "northwind", "follow-ups", "workbench"],
    ];
    const observers = keys.map((queryKey) => new QueryObserver(client, { queryKey, queryFn: async () => title }));
    const unsubscribes = observers.map((observer) => observer.subscribe(() => {}));
    await waitFor(() => keys.forEach((key) => expect(client.getQueryData(key)).toBe("old")));
    render(<RecordWorkspace {...props} openRecord={record} />, client);
    title = "new";
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => keys.forEach((key) => expect(client.getQueryData(key)).toBe("new")));
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });
  it("preserves explicit sort when closing with a different published default", async () => {
    const { parseRecordQuery } = await import("./record-query-state");
    const publishedSort = { field: "recordNo", direction: "asc" } as const;
    render(<RecordWorkspace {...props}
      schema={{ ...props.schema, defaultView: { ...props.schema.defaultView, sort: publishedSort } }}
      query={{ ...DEFAULT_RECORD_QUERY }} openRecord={record} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const url = new URL(router.replace.mock.calls.at(-1)![0], "http://localhost");
    const restored = parseRecordQuery(Object.fromEntries(url.searchParams), publishedSort);
    expect({ sort: restored.sort, direction: restored.direction }).toEqual({
      sort: "updatedAt", direction: "desc",
    });
  });
  it("passes the selected follow-up through the open record session", () => {
    render(
      <RecordWorkspace {...props} openRecord={record} followUpId="task-1" />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("定位跟进：task-1");
  });
  it("closes to the filtered list and reopens the same record after the list route arrives", () => {
    const { rerender } = render(
      <RecordWorkspace {...props} openRecord={record} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const url = new URL(
      router.replace.mock.calls.at(-1)![0],
      "http://localhost",
    );
    expect(url.pathname).toBe("/workspace/northwind/objects/customers");
    expect(url.searchParams.get("search")).toBe("客户");
    expect(url.searchParams.get("page")).toBe("2");
    rerender(<RecordWorkspace {...props} />);
    rerender(<RecordWorkspace {...props} openRecord={record} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("客户 A");
  });
  it("resets record edits when the URL selects another record or a newer server version", () => {
    const { rerender } = render(
      <RecordWorkspace {...props} openRecord={record} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("已保存");
    rerender(
      <RecordWorkspace
        {...props}
        openRecord={{ ...record, id: "record-b", title: "客户 B" }}
        initialEditing
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("客户 B");
    expect(screen.getByRole("dialog")).toHaveTextContent("编辑模式");
    rerender(
      <RecordWorkspace
        {...props}
        openRecord={{
          ...record,
          id: "record-b",
          title: "服务器更新",
          version: 2,
        }}
        initialEditing
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("服务器更新");
  });
});
