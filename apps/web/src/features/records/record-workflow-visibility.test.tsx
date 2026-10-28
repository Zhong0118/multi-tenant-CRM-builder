import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { RecordDetailPage } from "./record-detail-page";
import { RecordDetailDrawer } from "./record-detail-drawer";

vi.mock("@/features/follow-ups/follow-up-panel", () => ({
  FollowUpPanel: () => null,
}));
vi.mock("./record-activity-timeline", () => ({
  RecordActivityTimeline: () => null,
}));
vi.mock("./record-relations-panel", () => ({
  RecordRelationsPanel: () => null,
}));
vi.mock("@/features/attachments/record-attachments-panel", () => ({
  RecordAttachmentsPanel: () => null,
}));
vi.mock("@/features/automations/record-automation-panel", () => ({
  RecordAutomationPanel: () => null,
}));
vi.mock("./record-workflow-panel", () => ({
  RecordWorkflowPanel: () => <section aria-label="工作流请求入口" />,
}));

const schema: RuntimeObjectSchema = {
  publication: { number: 1, publishedAt: "2026-10-28T00:00:00Z" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: [],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canRead: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  },
  scopes: { read: "OWN", update: "OWN" },
};
const record: RecordSummary = {
  id: "r1",
  recordNo: "1",
  title: "客户甲",
  version: 1,
  ownerMemberId: "me",
  inPublicPool: false,
  ownershipExpiresAt: null,
  values: { name: "客户甲" },
  createdAt: "2026-10-28T00:00:00Z",
  updatedAt: "2026-10-28T00:00:00Z",
};

for (const [name, Component] of [
  ["page", RecordDetailPage],
  ["drawer", RecordDetailDrawer],
] as const) {
  it.each([false, true, undefined])(
    `${name}: mounts workflow queries only when enabled or talking to an older API (%s)`,
    (workflowEnabled) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const view = render(
        <QueryClientProvider client={client}>
          <Component
            tenantCode="northwind"
            schema={{ ...schema, workflowEnabled }}
            record={record}
            currentMemberId="me"
            onClose={vi.fn()}
            onChanged={vi.fn()}
          />
        </QueryClientProvider>,
      );
      expect(screen.queryByLabelText("工作流请求入口") !== null).toBe(
        workflowEnabled !== false,
      );
      if (name === "page")
        expect(screen.getByLabelText("业务活动")).toBeInTheDocument();
      view.unmount();
      client.clear();
    },
  );
}
