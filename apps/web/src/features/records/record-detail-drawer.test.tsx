import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecordSummary, RuntimeObjectSchema } from "@/features/objects/object-types";
import { RecordDetailDrawer } from "./record-detail-drawer";

vi.mock("./record-workflow-panel", () => ({ RecordWorkflowPanel: () => <section aria-label="工作流">执行工作流</section> }));
vi.mock("@/features/follow-ups/follow-up-panel", () => ({ FollowUpPanel: () => <section aria-label="下一步跟进">安排下一步</section> }));
vi.mock("./record-activity-timeline", () => ({ RecordActivityTimeline: () => <section aria-label="活动历史">历史内容</section> }));
vi.mock("./record-relations-panel", () => ({ RecordRelationsPanel: () => <section>关联内容</section> }));
vi.mock("@/features/attachments/record-attachments-panel", () => ({ RecordAttachmentsPanel: () => <section>附件内容</section> }));
const field = { required: false, defaultValue: null, validation: {}, config: {}, sortOrder: 1, isSystem: false, access: "READ_ONLY" as const, type: "TEXT" as const };
const schema: RuntimeObjectSchema = {
  publication: { number: 1, publishedAt: "2026-10-01" },
  object: { code: "customers", name: "客户", description: null, titleFieldKey: "name", icon: null, sortOrder: 1 },
  fields: [
    { ...field, id: "name", fieldKey: "name", label: "客户名称" },
    { ...field, id: "phase", fieldKey: "phase", label: "当前阶段" },
    { ...field, id: "notes", fieldKey: "notes", label: "详细说明" },
    { ...field, id: "secret", fieldKey: "secret", label: "隐藏字段", access: "HIDDEN" },
  ],
  defaultView: { code: "default", name: "默认", columnFieldKeys: ["phase", "secret"], sort: { field: "updatedAt", direction: "desc" } },
  actions: { canRead: true, canCreate: false, canUpdate: false, canDelete: false },
  scopes: { read: "ALL", update: "ALL" },
};
const record: RecordSummary = { id: "r1", recordNo: "1", title: "客户甲", version: 7, ownerMemberId: "m1", values: { name: "客户甲", phase: "洽谈中", notes: "长业务说明", secret: "不可见" }, createdAt: "2026-10-01", updatedAt: "2026-10-01" };

describe("record detail reading hierarchy", () => {
  it("does not claim an assigned owner is unassigned when the roster is unavailable", () => {
    render(<QueryClientProvider client={new QueryClient()}><RecordDetailDrawer tenantCode="northwind" schema={schema} record={record} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByText("负责人：已指定")).toBeVisible();
  });
  it("prioritizes published summary and tasks while keeping full fields and secondary content discoverable", () => {
    const client = new QueryClient();
    client.setQueryData(["relations", "northwind", "customers", "r1"], [{ id: "link1" }]);
    client.setQueryData(["attachments", "northwind", "customers", "r1"], []);
    render(<QueryClientProvider client={client}><RecordDetailDrawer tenantCode="northwind" schema={schema} record={record} members={[{ id: "m1", displayName: "林晨" }]} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>);
    const summary = screen.getByRole("region", { name: "记录摘要" });
    expect(within(summary).getByText("洽谈中")).toBeVisible();
    expect(within(summary).getByText(/负责人：林晨/)).toBeVisible();
    expect(screen.queryByText("不可见")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "工作流" })).toBeVisible();
    expect(screen.getByRole("region", { name: "下一步跟进" })).toBeVisible();
    expect(screen.getByRole("region", { name: "活动历史" })).toBeVisible();
    expect(screen.getByText("长业务说明")).not.toBeVisible();
    fireEvent.click(screen.getByText("完整业务字段"));
    expect(screen.getByText("长业务说明")).toBeVisible();
    expect(screen.getByText("关联业务记录（1）")).toBeVisible();
    expect(screen.getByText("附件（暂无附件）")).toBeVisible();
    expect(screen.getByText("关联内容")).not.toBeVisible();
    expect(screen.getByText("附件内容")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
});
