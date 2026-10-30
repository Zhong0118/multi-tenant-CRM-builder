import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RecordList } from "@/features/records/record-list";
import { RecordDetailPage } from "@/features/records/record-detail-page";
import { RecordDetailDrawer } from "@/features/records/record-detail-drawer";
import { recordApi } from "@/features/records/record-api";
import { DEFAULT_RECORD_QUERY } from "@/features/records/record-query-state";
import type {
  RuntimeObjectSchema,
  RecordSummary,
} from "@/features/objects/object-types";
import { telephonyApi } from "./telephony-api";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/features/follow-ups/follow-up-panel", () => ({
  FollowUpPanel: () => null,
}));
vi.mock("@/features/records/record-activity-timeline", () => ({
  RecordActivityTimeline: () => null,
}));
vi.mock("@/features/records/record-relations-panel", () => ({
  RecordRelationsPanel: () => null,
}));
vi.mock("@/features/attachments/record-attachments-panel", () => ({
  RecordAttachmentsPanel: () => null,
}));
vi.mock("@/features/records/record-workflow-panel", () => ({
  RecordWorkflowPanel: () => null,
}));
vi.mock("@/features/automations/record-automation-panel", () => ({
  RecordAutomationPanel: () => null,
}));
const schema: RuntimeObjectSchema = {
  publication: { number: 1, publishedAt: "2026-10-30T00:00:00Z" },
  object: {
    code: "customers",
    name: "客户",
    titleFieldKey: "name",
    description: null,
    icon: null,
    sortOrder: 1,
  },
  fields: [
    {
      id: "phone",
      fieldKey: "phone",
      label: "组员电话",
      type: "PHONE",
      access: "HIDDEN",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 1,
      isSystem: false,
    },
  ],
  groupFieldAccess: { phone: "READ_ONLY" },
  queryFieldKeys: [],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["phone"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  scopes: { read: "GROUP", update: "OWN" },
  actions: {
    canRead: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  },
};
const record: RecordSummary = {
  id: "r1",
  recordNo: "1",
  title: "组员客户",
  version: 1,
  ownerMemberId: "other",
  inPublicPool: false,
  ownershipExpiresAt: null,
  values: { phone: "13800000001" },
  fieldAccess: { phone: "READ_ONLY" },
  createdAt: "2026-10-30T00:00:00Z",
  updatedAt: "2026-10-30T00:00:00Z",
};
beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.spyOn(recordApi, "detail").mockResolvedValue(record);
  vi.spyOn(recordApi, "list").mockResolvedValue({
    items: [record],
    page: 1,
    limit: 20,
    total: 1,
  });
  vi.spyOn(telephonyApi, "runtime").mockResolvedValue({
    enabled: true,
    mode: "MOCK",
    available: true,
    reason: null,
    liveEnabled: false,
    callerPhone: "13900000001",
    fields: [{ fieldKey: "phone", label: "组员电话" }],
  });
});
function provider(children: React.ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
it("opens group-readable dialing from the list without eager runtime requests or navigation", async () => {
  const navigate = vi.fn();
  render(
    provider(
      <RecordList
        tenantCode="northwind"
        schema={schema}
        query={{ ...DEFAULT_RECORD_QUERY, scope: "group" }}
        initialPage={{ items: [record], page: 1, limit: 20, total: 1 }}
        currentMemberId="me"
        navigate={navigate}
      />,
    ),
  );
  expect(telephonyApi.runtime).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByLabelText("拨打 组员客户")[0]);
  await screen.findByText("13900000001");
  expect(telephonyApi.runtime).toHaveBeenCalledExactlyOnceWith("northwind", {
    objectCode: "customers",
    recordId: "r1",
  });
  expect(navigate).not.toHaveBeenCalled();
});
it.each([RecordDetailPage, RecordDetailDrawer])(
  "offers the same call confirmation on record detail %s",
  async (Component) => {
    render(
      provider(
        <Component
          tenantCode="northwind"
          schema={schema}
          record={record}
          currentMemberId="me"
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getAllByLabelText("拨打 组员客户")[0]);
    await screen.findByText("13900000001");
    expect(screen.getByLabelText("我已核对主叫和被叫号码")).toBeInTheDocument();
  },
);
it("hides the call entry when actual record access hides its phone", () => {
  render(
    provider(
      <RecordDetailPage
        tenantCode="northwind"
        schema={schema}
        record={{ ...record, fieldAccess: { phone: "HIDDEN" } }}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    ),
  );
  expect(screen.queryByLabelText("拨打 组员客户")).not.toBeInTheDocument();
  expect(telephonyApi.runtime).not.toHaveBeenCalled();
});
