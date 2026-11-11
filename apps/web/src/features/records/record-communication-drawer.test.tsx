import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { RecordApi } from "./record-api";
import { RecordCommunicationDrawer } from "./record-communication-drawer";

it("preserves an unsaved communication draft when a background refresh fails and is retried", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const record = { id: "r1", title: "客户甲", recordNo: "1" } as RecordSummary;
  const schema = {
    object: { code: "customers" },
    actions: { canUpdate: true },
    scopes: { update: "ALL" },
  } as RuntimeObjectSchema;
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
