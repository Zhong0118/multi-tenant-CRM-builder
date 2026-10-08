import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { recordApi } from "./record-api";
import Link from "next/link";
import { RecordWorkspace, type RecordWorkspaceProps } from "./record-workspace";
import type { RecordSummary } from "@/features/objects/object-types";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
import { formatDateTime } from "./record-display-value";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./record-list", async (importOriginal) => ({
  ...await importOriginal<typeof import("./record-list")>(),
  RecordList: () => <div>列表<Link href="/workspace/northwind/objects/customers/record-a?page=2">客户 A 链接</Link></div>,
}));
const composition = vi.hoisted(() => ({ real: false }));
vi.mock("./record-workflow-panel", () => ({ RecordWorkflowPanel: () => null }));
vi.mock("@/features/follow-ups/follow-up-panel", () => ({ FollowUpPanel: () => null }));
vi.mock("./record-activity-timeline", () => ({ RecordActivityTimeline: () => null }));
vi.mock("./record-relations-panel", () => ({ RecordRelationsPanel: () => null }));
vi.mock("@/features/attachments/record-attachments-panel", () => ({ RecordAttachmentsPanel: () => null }));
vi.mock("./record-detail-drawer", async (importOriginal) => {
  const original = await importOriginal<typeof import("./record-detail-drawer")>();
  return {
  RecordDetailDrawer: (props: import("./record-detail-drawer").RecordDetailDrawerProps) => composition.real ? <original.RecordDetailDrawer {...props} /> : <MockDrawer {...props} />,
};
});
const MockDrawer = ({
    record,
    initialEditing,
    followUpId,
    onClose,
    onChanged,
  }: {
    record: RecordSummary;
    initialEditing?: boolean;
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
  );
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

beforeEach(() => {
  vi.clearAllMocks();
  composition.real = false;
});

describe("record workspace navigation", () => {
  it("restores focus to the retained record link on ordinary list close", async () => {
    render(<RecordWorkspace {...props} openRecord={record} />);
    vi.spyOn(screen.getByRole("link", { name: "客户 A 链接" }), "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "客户 A 链接" })).toHaveFocus());
  });
  it("focuses the record link in the list route's new workspace after close", async () => {
    // Real lists are laid out; jsdom reports no client rects for any element.
    const rects = vi.spyOn(HTMLAnchorElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    onTestFinished(() => rects.mockRestore());
    const { rerender, unmount } = render(<RecordWorkspace {...props} openRecord={record} />);
    const closing = screen.getByRole("link", { name: "客户 A 链接" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(closing).toHaveFocus());
    // The list URL mounts a fresh workspace whose list replaces the old link.
    rerender(<RecordWorkspace {...props} />);
    const arrived = screen.getByRole("link", { name: "客户 A 链接" });
    expect(arrived).not.toBe(closing);
    await waitFor(() => expect(arrived).toHaveFocus());
    // The request is settled: a later visit to the list does not steal focus.
    unmount();
    render(<RecordWorkspace {...props} />);
    expect(document.body).toHaveFocus();
  });
  it.each(["关闭", "删除"])("%s returns to the exact validated source", async (action) => {
    sessionStorage.clear();
    render(<RecordWorkspace {...props} openRecord={record} returnTo="/workspace/northwind/follow-ups?status=DONE&page=3" />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith("/workspace/northwind/follow-ups?status=DONE&page=3"));
    expect(sessionStorage.getItem("crm:source-return-focus")).toBe("/workspace/northwind/follow-ups?status=DONE&page=3");
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
  it.each(["save", "delete"])("keeps committed %s visible when a real cache refetch fails", async (action) => {
    composition.real = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let failed = false;
    const key = ["workspace", "northwind", "records", "customers"];
    const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => {
      if (failed) throw new Error("cache offline");
      return "seeded";
    } });
    const unsubscribe = observer.subscribe(() => {});
    await waitFor(() => expect(client.getQueryData(key)).toBe("seeded"));
    const update = vi.spyOn(recordApi, "update").mockResolvedValue({ ...record, title: "已保存", values: { name: "已保存" }, version: 2, updatedAt: "2026-09-10T02:30:00.000Z" });
    const remove = vi.spyOn(recordApi, "remove").mockResolvedValue({ accepted: true });
    render(<RecordWorkspace {...props} openRecord={record} initialEditing={action === "save"} returnTo="/workspace/northwind/follow-ups?status=OPEN&page=1" />, client);
    failed = true;
    if (action === "save") {
      fireEvent.change(screen.getByLabelText("客户名称"), { target: { value: "已保存" } });
      fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: /^删\s*除$/ }));
      fireEvent.click(await screen.findByRole("button", { name: "删除记录" }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(action === "save" ? "记录已保存，但刷新暂时失败" : "记录已删除，但刷新暂时失败");
    expect(client.getQueryState(key)?.status).toBe("error");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    if (action === "save") {
      expect(update).toHaveBeenCalledTimes(1);
      // The drawer shows the saved record, not the stale one.
      expect(screen.getByText(formatDateTime("2026-09-10T02:30:00.000Z"))).toBeVisible();
      expect(screen.queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument();
    } else {
      expect(remove).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /^删\s*除$/ })).toBeDisabled();
      expect(screen.queryByRole("button", { name: /^编\s*辑$/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^删\s*除$/ }));
      expect(remove).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
      expect(router.replace).toHaveBeenCalledWith("/workspace/northwind/follow-ups?status=OPEN&page=1");
      expect(sessionStorage.getItem("crm:source-return-focus")).toBe("/workspace/northwind/follow-ups?status=OPEN&page=1");
    }
    unsubscribe();
    client.clear();
    update.mockRestore();
    remove.mockRestore();
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
  it.each(["关闭", "删除"])("keeps the drawer shut when a refresh lands after %s but before the route change", async (action) => {
    const { rerender } = render(<RecordWorkspace {...props} openRecord={record} />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    rerender(<RecordWorkspace {...props} openRecord={{ ...record, version: 2 }} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("follows the URL to another record and adopts its newer server version", () => {
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

  it("synchronizes refreshed server values in reading mode", () => {
    composition.real = true;
    const view = render(<RecordWorkspace {...props} openRecord={record} />);
    view.rerender(<RecordWorkspace {...props} openRecord={{ ...record, version: 3, title: "服务器最新", values: { name: "服务器最新" } }} />);
    expect(screen.getByText("版本 v3")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue("服务器最新");
  });

  it.each(["initialEditing", "id", "tenant", "object", "followUp"])("resets an active draft on %s route identity change", (identity) => {
    composition.real = true;
    const view = render(<RecordWorkspace {...props} openRecord={record} initialEditing />);
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), { target: { value: "路由前草稿" } });
    view.rerender(<RecordWorkspace
      {...props}
      tenantCode={identity === "tenant" ? "contoso" : props.tenantCode}
      schema={identity === "object" ? { ...props.schema, object: { ...props.schema.object, code: "contacts" } } : props.schema}
      openRecord={identity === "id" ? { ...record, id: "record-b", values: { name: "客户 B" } } : record}
      initialEditing={identity !== "initialEditing"}
      followUpId={identity === "followUp" ? "task-2" : undefined}
    />);
    if (identity === "initialEditing") {
      expect(screen.queryByRole("textbox", { name: "客户名称" })).not.toBeInTheDocument();
      expect(screen.getByText("版本 v1")).toBeVisible();
    } else {
      expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(identity === "id" ? "客户 B" : "客户 A");
    }
  });

  it("uses refreshed field permissions when submitting an active draft", async () => {
    composition.real = true;
    const fields = [
      ...props.schema.fields,
      { ...props.schema.fields[0], id: "field-secret", fieldKey: "secret", label: "内部备注", required: false },
      { ...props.schema.fields[0], id: "field-public", fieldKey: "public", label: "公开备注", required: false },
    ];
    const schema = { ...props.schema, fields };
    const update = vi.spyOn(recordApi, "update").mockRejectedValue({ code: "RECORD_VERSION_CONFLICT", message: "版本冲突", status: 409, requestId: "req_fields", fieldErrors: {} });
    const view = render(<RecordWorkspace {...props} schema={schema} openRecord={record} initialEditing />);
    fireEvent.change(screen.getByLabelText("客户名称"), { target: { value: "草稿名称" } });
    fireEvent.change(screen.getByLabelText("内部备注"), { target: { value: "私密草稿" } });
    fireEvent.change(screen.getByLabelText("公开备注"), { target: { value: "允许发送" } });
    view.rerender(<RecordWorkspace {...props} schema={{ ...schema, fields: fields.map((field) => ({ ...field, access: field.fieldKey === "name" ? "READ_ONLY" : field.fieldKey === "secret" ? "HIDDEN" : "EDIT" })) }} openRecord={{ ...record, version: 2 }} initialEditing />);
    expect(screen.queryByLabelText("内部备注")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "客户名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByRole("button", { name: "重新载入记录" });
    expect(update).toHaveBeenCalledWith("northwind", "customers", "record-a", expect.objectContaining({ version: 1, values: { public: "允许发送" } }));
    update.mockRestore();
  });

  it("keeps a reopened draft through a delayed save and refreshed server version", async () => {
    composition.real = true;
    const { browserApiClient } = await import("@/lib/api/browser-client");
    let resolveUpdate!: (response: Awaited<ReturnType<typeof browserApiClient.PATCH>>) => void;
    const update = vi.spyOn(browserApiClient, "PATCH").mockImplementation(() => {
      if (update.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveUpdate = resolve; });
      }
      return Promise.resolve({
        error: {
          code: "RECORD_VERSION_CONFLICT",
          message: "记录已被其他成员更新。",
          fieldErrors: {},
          requestId: "req_conflict",
        },
        response: new Response(null, { status: 409 }),
      });
    });
    const editableSchema = {
      ...props.schema,
      actions: { ...props.schema.actions, canUpdate: true },
    };
    const view = render(
      <RecordWorkspace
        {...props}
        schema={editableSchema}
        openRecord={record}
        initialEditing
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "旧保存输入" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}",
      expect.objectContaining({ body: expect.objectContaining({ version: 1 }) }),
    ));

    fireEvent.click(screen.getByRole("button", { name: /^取\s*消$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), {
      target: { value: "新会话草稿" },
    });

    await act(async () => {
      resolveUpdate({
        data: { ...record, title: "旧保存输入", version: 2, values: { name: "旧保存输入" } },
        response: new Response(null, { status: 200 }),
      });
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue("新会话草稿");
    view.rerender(
      <RecordWorkspace
        {...props}
        schema={editableSchema}
        openRecord={{
          ...record,
          title: "旧保存输入",
          version: 2,
          values: { name: "旧保存输入" },
        }}
        initialEditing
      />,
    );

    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue(
      "新会话草稿",
    );

    const revokedSchema = {
      ...editableSchema,
      actions: { ...editableSchema.actions, canUpdate: false },
      fields: editableSchema.fields.map((field) => ({
        ...field,
        access: "READ_ONLY" as const,
      })),
    };
    view.rerender(
      <RecordWorkspace
        {...props}
        schema={revokedSchema}
        openRecord={{ ...record, title: "旧保存输入", version: 2, values: { name: "旧保存输入" } }}
        initialEditing
      />,
    );
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(update).toHaveBeenCalledTimes(1);

    view.rerender(
      <RecordWorkspace
        {...props}
        schema={editableSchema}
        openRecord={{ ...record, title: "旧保存输入", version: 2, values: { name: "旧保存输入" } }}
        initialEditing
      />,
    );
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue("新会话草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("button", { name: "重新载入记录" })).toBeInTheDocument();
    expect(update).toHaveBeenLastCalledWith(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}",
      expect.objectContaining({ body: expect.objectContaining({ version: 1, values: { name: "新会话草稿" } }) }),
    );
    expect(screen.getByRole("textbox", { name: "客户名称" })).toHaveValue("新会话草稿");
    update.mockRestore();
  });
});
