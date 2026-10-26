import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordAutomationPanel } from "./record-automation-panel";
import type { AutomationApi } from "./automation-api";
function setup(
  execute: AutomationApi["execute"],
  onChanged = vi.fn().mockResolvedValue(undefined),
  overrides: Partial<AutomationApi> = {},
) {
  const api: AutomationApi = {
    stats: vi.fn(),
    statsEvents: vi.fn(),
    configuration: vi.fn(),
    save: vi.fn(),
    previewDraft: vi.fn(),
    runtime: vi.fn().mockResolvedValue({
      items: [
        {
          key: "confirm",
          label: "确认开单",
          targetObjectCode: "orders",
          targetObjectName: "开单",
          inputFields: [],
        },
      ],
    }),
    history: vi.fn().mockResolvedValue({ items: [] }),
    preview: vi.fn().mockResolvedValue({
      ruleKey: "confirm",
      targetObjectCode: "orders",
      targetObjectName: "开单",
      values: { name: "测试客户" },
      ownerMemberId: "m1",
      sourceRecordId: "r1",
    }),
    execute,
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecordAutomationPanel
        tenantCode="demo"
        objectCode="customers"
        recordId="r1"
        recordVersion={1}
        api={api}
        onRecordChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return api;
}
const result = {
  id: "e1",
  ruleKey: "confirm",
  ruleLabel: "确认开单",
  triggerType: "MANUAL" as const,
  sourceRecordId: "r1",
  targetObjectCode: "orders",
  targetRecordId: "o1",
  targetRecordNo: "9",
  actorMemberId: "m1",
  executedAt: "2026-10-21T00:00:00Z",
  publicationId: "p1",
};
describe("RecordAutomationPanel", () => {
  it("previews before execution and preserves success when refreshing the source fails", async () => {
    const api = setup(
      vi.fn().mockResolvedValue(result),
      vi.fn().mockRejectedValue(new Error("refresh failed")),
    );
    fireEvent.click(await screen.findByText("确认开单"));
    fireEvent.click(screen.getByLabelText("预览"));
    await screen.findByText("测试客户");
    expect(api.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("确认创建并关联"));
    expect(
      await screen.findByText(
        "已创建记录，但详情刷新失败，请刷新页面查看，无需重复执行",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看新记录 #9" })).toHaveAttribute(
      "href",
      "/workspace/demo/objects/orders/o1",
    );
  });
  it("retries an uncertain result with the same request id", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(result);
    setup(execute);
    fireEvent.click(await screen.findByText("确认开单"));
    fireEvent.click(screen.getByLabelText("预览"));
    await screen.findByText("测试客户");
    fireEvent.click(screen.getByText("确认创建并关联"));
    fireEvent.click(await screen.findByText("重试本次操作"));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
  });
});

it("preserves readable history when the separate action list fails", async () => {
  setup(vi.fn(), undefined, {
    runtime: vi.fn().mockRejectedValue(new Error("unavailable")),
    history: vi.fn().mockResolvedValue({ items: [result] }),
  });
  expect(
    await screen.findByRole("link", { name: "记录 #9" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("跨表动作加载失败")).toBeInTheDocument();
});
