import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { RecordDetailPage } from "./record-detail-page";
import { RecordDetailDrawer } from "./record-detail-drawer";

vi.mock("@/features/follow-ups/follow-up-panel", () => ({
  FollowUpPanel: ({ record }: { record: { canCreate: boolean } }) => (
    <button disabled={!record.canCreate}>新增跟进验证</button>
  ),
}));
vi.mock("./record-activity-timeline", () => ({
  RecordActivityTimeline: ({ canCreate }: { canCreate: boolean }) => (
    <button disabled={!canCreate}>新增活动验证</button>
  ),
}));
vi.mock("./record-relations-panel", () => ({
  RecordRelationsPanel: ({ canUpdate }: { canUpdate: boolean }) => (
    <button disabled={!canUpdate}>新增关联验证</button>
  ),
}));
vi.mock("@/features/attachments/record-attachments-panel", () => ({
  RecordAttachmentsPanel: ({ canUpdate }: { canUpdate: boolean }) => (
    <button disabled={!canUpdate}>新增附件验证</button>
  ),
}));
vi.mock("./record-workflow-panel", () => ({ RecordWorkflowPanel: () => null }));
vi.mock("@/features/automations/record-automation-panel", () => ({
  RecordAutomationPanel: () => null,
}));

const field = {
  type: "TEXT",
  required: false,
  defaultValue: null,
  validation: {},
  config: {},
  sortOrder: 1,
  isSystem: false,
  access: "EDIT",
} as const;
const schema = {
  publication: { number: 1, publishedAt: "2026-10-29" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [
    { ...field, id: "name", fieldKey: "name", label: "客户名称" },
    { ...field, id: "secret", fieldKey: "secret", label: "隐私字段" },
  ],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["name", "secret"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canRead: true,
    canCreate: false,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "GROUP", update: "OWN" },
} as RuntimeObjectSchema;
const record = {
  id: "r1",
  recordNo: "1",
  title: "组员客户",
  version: 1,
  ownerMemberId: "teammate",
  inPublicPool: false,
  ownershipExpiresAt: null,
  values: { name: "组员客户", secret: "机密值" },
  createdAt: "2026-10-29",
  updatedAt: "2026-10-29",
  fieldAccess: { name: "EDIT", secret: "HIDDEN" },
  canEditFields: true,
} as RecordSummary;

for (const [name, Component] of [
  ["page", RecordDetailPage],
  ["drawer", RecordDetailDrawer],
] as const) {
  it(`${name}: supports teammate field editing without authorizing other operations`, async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Component
          tenantCode="northwind"
          schema={schema}
          record={record}
          currentMemberId="leader"
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("机密值")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^编\s*辑$/ })).toBeEnabled();
    if (name === "page") {
      expect(
        screen.getByRole("button", { name: "新增跟进验证" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("tab", { name: "附件" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "新增附件验证" }),
        ).toBeDisabled(),
      );
    } else {
      expect(
        screen.getByRole("button", { name: "新增跟进验证" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByText("附件（展开查看）"));
      expect(
        screen.getByRole("button", { name: "新增附件验证" }),
      ).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    expect(screen.getByRole("textbox", { name: "客户名称" })).toBeEnabled();
    expect(screen.queryByLabelText("隐私字段")).not.toBeInTheDocument();
  });
}
