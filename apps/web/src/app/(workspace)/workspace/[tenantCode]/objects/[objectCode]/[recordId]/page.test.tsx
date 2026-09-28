import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecordDetailPage from "./page";

vi.mock("@/lib/auth/require-workspace", () => ({
  requireWorkspace: async () => ({ role: "EMPLOYEE", memberId: "member-1" }),
}));
vi.mock("@/lib/auth/load-runtime-object", () => ({
  loadRuntimeObject: async () => ({
    schema: {
      defaultView: { sort: { field: "updatedAt", direction: "desc" } },
      fields: [],
    },
    members: [],
    isAdmin: false,
  }),
  loadRecordPage: async () => ({ items: [], total: 0, page: 1, limit: 20 }),
  loadRecord: async () => ({ id: "record-1", title: "客户 A" }),
}));
vi.mock("@/features/records/record-workspace", () => ({
  RecordWorkspace: ({ followUpId }: { followUpId?: string }) => (
    <div>跟进目标：{followUpId ?? "无"}</div>
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
