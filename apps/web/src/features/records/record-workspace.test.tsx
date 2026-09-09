import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordWorkspace, type RecordWorkspaceProps } from "./record-workspace";
import type { RecordSummary } from "@/features/objects/object-types";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./record-list", () => ({ RecordList: () => <div>列表</div> }));
vi.mock("./record-detail-drawer", () => ({
  RecordDetailDrawer: ({
    record,
    initialEditing,
    onClose,
    onChanged,
  }: {
    record: RecordSummary;
    initialEditing: boolean;
    onClose: () => void;
    onChanged: (record: RecordSummary) => void;
  }) => (
    <div role="dialog">
      <span>{record.title}</span>
      <span>{initialEditing ? "编辑模式" : "查看模式"}</span>
      <button onClick={onClose}>关闭</button>
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

describe("record workspace navigation", () => {
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
