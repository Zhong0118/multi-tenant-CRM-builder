import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { RecordSummary, RuntimeObjectSchema } from "@/features/objects/object-types";
import { RecordDetailPage } from "./record-detail-page";
import { recordApi } from "./record-api";
import { recordPoolApi } from "./record-pool-api";

vi.mock("@/features/follow-ups/follow-up-panel", () => ({ FollowUpPanel: () => null }));
vi.mock("./record-activity-timeline", () => ({ RecordActivityTimeline: () => null }));
vi.mock("./record-relations-panel", () => ({ RecordRelationsPanel: () => null }));
vi.mock("@/features/attachments/record-attachments-panel", () => ({ RecordAttachmentsPanel: () => null }));
vi.mock("./record-workflow-panel", () => ({ RecordWorkflowPanel: () => null }));
vi.mock("@/features/automations/record-automation-panel", () => ({ RecordAutomationPanel: () => null }));

it("waits for contact confirmation and its refresh before opening an editor with the new version", async () => {
  const original: RecordSummary = {
    id: "r1", recordNo: "1", title: "客户甲", version: 7, ownerMemberId: "me",
    inPublicPool: false, poolStage: "PENDING_CONTACT", ownershipExpiresAt: "2026-10-24T00:00:00Z",
    values: { name: "客户甲" }, createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z",
  };
  const updated: RecordSummary = { ...original, version: 8, poolStage: "FOLLOWING" };
  const schema: RuntimeObjectSchema = {
    publication: { number: 1, publishedAt: "2026-10-23T00:00:00Z" },
    object: { code: "customers", name: "客户", description: null, titleFieldKey: "name", icon: null, sortOrder: 1 },
    fields: [{ id: "name", fieldKey: "name", label: "客户名称", type: "TEXT", access: "EDIT", required: true, defaultValue: null, validation: {}, config: {}, sortOrder: 1, isSystem: false }],
    defaultView: { code: "default", name: "默认", columnFieldKeys: ["name"], sort: { field: "updatedAt", direction: "desc" } },
    actions: { canRead: true, canCreate: true, canUpdate: true, canDelete: false },
    scopes: { read: "OWN", update: "OWN" },
  };
  let finishConfirmation!: (result: { recordId: string; version: number }) => void;
  let finishRefresh!: (result: RecordSummary) => void;
  const confirmation = new Promise<{ recordId: string; version: number }>((resolve) => { finishConfirmation = resolve; });
  const refresh = new Promise<RecordSummary>((resolve) => { finishRefresh = resolve; });
  const ownership = vi.spyOn(recordPoolApi, "changeOwnership").mockReturnValue(confirmation);
  const api = { ...recordApi, detail: vi.fn().mockReturnValue(refresh), update: vi.fn().mockResolvedValue({ ...updated, version: 9 }) };
  function Host() {
    const [record, setRecord] = useState(original);
    return <RecordDetailPage tenantCode="northwind" schema={schema} record={record} currentMemberId="me"
      poolConfig={{ enabled: true, version: 1, ownershipTtlHours: null, lifecycleEnabled: true, contactTtlHours: 24, followUpTtlHours: 720 }}
      api={api} onClose={vi.fn()} onChanged={(next) => { if (next) setRecord(next); }} />;
  }
  render(<QueryClientProvider client={new QueryClient()}><Host /></QueryClientProvider>);
  try {
    fireEvent.click(screen.getByRole("button", { name: "确认已联系 客户甲" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认建立联系" }));
    await waitFor(() => expect(ownership).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /^编\s*辑$/ })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    expect(screen.queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument();

    await act(async () => { finishConfirmation({ recordId: "r1", version: 8 }); });
    await waitFor(() => expect(api.detail).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /^编\s*辑$/ })).toBeDisabled();

    await act(async () => { finishRefresh(updated); });
    await waitFor(() => expect(screen.getByRole("button", { name: /^编\s*辑$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^编\s*辑$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "客户名称" }), { target: { value: "已确认需求的客户" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("northwind", "customers", "r1", { version: 8, values: { name: "已确认需求的客户" } }));
  } finally {
    ownership.mockRestore();
  }
});
