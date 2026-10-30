import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecordDetailPage from "./page";
import ObjectRecordsPage from "../page";
const runtime = vi.hoisted(() => ({
  schema: {
    defaultView: { sort: { field: "updatedAt", direction: "desc" } },
    fields: [] as { fieldKey: string; type: string; access: string }[],
    queryFieldKeys: undefined as string[] | undefined,
    scopes: { read: "OWN", update: "OWN" },
  },
  loadPage: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 })),
}));

beforeEach(() => { runtime.schema.scopes.read = "OWN"; runtime.loadPage.mockClear(); });

vi.mock("@/lib/auth/require-workspace", () => ({
  requireWorkspace: async () => ({ role: "EMPLOYEE", memberId: "member-1" }),
}));
vi.mock("@/lib/auth/load-runtime-object", () => ({
  loadRuntimeObject: async () => ({
    schema: runtime.schema,
    members: [],
    isAdmin: false,
  }),
  loadRecordPage: runtime.loadPage,
  loadRecord: async () => ({ id: "record-1", title: "客户 A" }),
}));
vi.mock("@/features/records/record-workspace", () => ({
  RecordWorkspace: ({
    followUpId,
    query,
  }: {
    followUpId?: string;
    query: { sort: string };
  }) => (
    <div>
      跟进目标：{followUpId ?? "无"}
      <span>排序：{query.sort}</span>
    </div>
  ),
}));

describe("record detail deep link", () => {
  it("passes the selected follow-up ID from the URL to the record workspace", async () => {
    render(
      await RecordDetailPage({
        params: Promise.resolve({
          tenantCode: "northwind",
          objectCode: "leads",
          recordId: "record-1",
        }),
        searchParams: Promise.resolve({ followUp: "task-1" }),
      }),
    );
    expect(screen.getByText("跟进目标：task-1")).toBeInTheDocument();
  });
});

it.each([ObjectRecordsPage, RecordDetailPage])("loads own records on the server for a group leader's default list", async (Page) => {
  runtime.schema.scopes.read = "GROUP";
  await Page({ params: Promise.resolve({ tenantCode: "northwind", objectCode: "customers", recordId: "record-1" }), searchParams: Promise.resolve({}) });
  expect(runtime.loadPage).toHaveBeenCalledWith("northwind", "customers", expect.objectContaining({ scope: "mine" }));
});

it.each([ObjectRecordsPage, RecordDetailPage])("keeps the selected teammate after refresh or opening a detail", async (Page) => {
  runtime.schema.scopes.read = "GROUP";
  await Page({ params: Promise.resolve({ tenantCode: "northwind", objectCode: "customers", recordId: "record-1" }), searchParams: Promise.resolve({ scope: "group", ownerMemberId: "teammate", page: "2" }) });
  expect(runtime.loadPage).toHaveBeenCalledWith("northwind", "customers", expect.objectContaining({ scope: "group", ownerMemberId: "teammate", page: 2 }));
});

it.each([ObjectRecordsPage, RecordDetailPage])(
  "drops URL sorting on a field hidden in part of the record scope",
  async (Page) => {
    runtime.schema.fields = [
      { fieldKey: "secret", type: "TEXT", access: "EDIT" },
    ];
    runtime.schema.queryFieldKeys = [];
    render(
      await Page({
        params: Promise.resolve({
          tenantCode: "northwind",
          objectCode: "customers",
          recordId: "record-1",
        }),
        searchParams: Promise.resolve({ sort: "secret" }),
      }),
    );
    expect(screen.getByText("排序：updatedAt")).toBeInTheDocument();
    runtime.schema.fields = [];
    runtime.schema.queryFieldKeys = undefined;
  },
);
