import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { RecordApi } from "./record-api";
import {
  RecordCommunicationDrawer,
  RecordCommunicationPreview,
} from "./record-communication-drawer";

it("preserves an unsaved communication draft when a background refresh fails and is retried", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const record = { id: "r1", title: "客户甲", recordNo: "1" } as RecordSummary;
  const schema = {
    object: { code: "customers" },
    fields: [],
    actions: { canUpdate: true },
    scopes: { update: "ALL" },
  } as unknown as RuntimeObjectSchema;
  const detail = vi.fn().mockResolvedValue(record);
  const api = {
    detail,
    listActivities: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
  } as unknown as RecordApi;
  render(
    <QueryClientProvider client={client}>
      <RecordCommunicationDrawer
        tenantCode="demo"
        schema={schema}
        record={record}
        isAdmin
        api={api}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "追加活动" }));
  fireEvent.change(screen.getByLabelText("内容"), {
    target: { value: "还没有保存的沟通内容" },
  });
  detail.mockRejectedValueOnce(new Error("network interrupted"));
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [
        "workspace",
        "demo",
        "objects",
        "customers",
        "records",
        "r1",
        "communication-detail",
      ],
    });
  });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("内容")).toHaveValue("还没有保存的沟通内容");
  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  expect(screen.getByLabelText("内容")).toHaveValue("还没有保存的沟通内容");
});

it("reveals the complete latest communication on focus without opening history", async () => {
  const onOpen = vi.fn();
  const content = "需要补充报价单\n采购确认以后再安排会议\n最后一行保留";
  const record = {
    title: "客户甲",
    latestActivity: {
      activityType: "CALL",
      content,
      outcome: "CONNECTED",
      actorDisplayName: "小李",
      createdAt: "2026-11-24T13:00:00Z",
    },
  } as RecordSummary;
  render(<RecordCommunicationPreview record={record} onOpen={onOpen} />);
  const preview = screen.getByRole("button", { name: "查看动态 客户甲" });
  fireEvent.focus(preview);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain(content);
  expect(tooltip).toHaveTextContent("小李");
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(preview);
  expect(onOpen).toHaveBeenCalledTimes(1);
});
