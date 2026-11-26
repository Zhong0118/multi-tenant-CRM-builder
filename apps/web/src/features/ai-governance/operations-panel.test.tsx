import { catalogFixture } from "./catalog.fixture";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsPanel } from "./operations-panel";
import { workspaceAi, type OperationPage } from "./workspace-api";

const row: OperationPage["items"][number] = {
  id: "op",
  memberId: "zhao",
  feature: "write_proposal",
  source: "proposal",
  status: "EXECUTED",
  confirmedByMemberId: "zhao",
  createdAt: "2026-11-24T08:25:00Z",
  updatedAt: "2026-11-24T08:26:00Z",
};
function show() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <OperationsPanel
        catalog={catalogFixture}
        tenantCode="example"
        memberId="manager"
        members={[
          {
            memberId: "zhao",
            name: "赵晨",
            active: true,
            usedTokens: "1234",
            reservedTokens: "0",
          },
        ]}
      />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.restoreAllMocks());
describe("operation records", () => {
  it("fetches an individual detail only on open and omits redacted content and target links", async () => {
    vi.spyOn(workspaceAi, "operations").mockResolvedValue({
      items: [row],
      nextCursor: null,
    });
    const get = vi.spyOn(workspaceAi, "detail").mockResolvedValue({
      ...row,
      requestText: null,
      recordId: null,
      objectId: null,
      objectCode: null,
      items: [],
      auditId: null,
      requestId: null,
    });
    show();
    const target = await screen.findByRole("button", { name: "写入提议" });
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(target);
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("发起人")).toBeVisible();
    expect(get).toHaveBeenCalledWith("example", "op");
    expect(within(drawer).queryByText("提问原文")).toBeNull();
    expect(within(drawer).queryByRole("link")).toBeNull();
  });
  it("keeps member and status in view and the other filters behind 更多筛选", async () => {
    vi.spyOn(workspaceAi, "operations").mockResolvedValue({
      items: [row],
      nextCursor: null,
    });
    show();
    await screen.findByRole("button", { name: "写入提议" });
    expect(screen.getByLabelText("全部成员")).toBeInTheDocument();
    expect(screen.getByLabelText("全部状态")).toBeInTheDocument();
    expect(screen.queryByLabelText("写入类型")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多筛选" }));
    expect(screen.getByLabelText("写入类型")).toBeInTheDocument();
    expect(screen.getByLabelText("起始日期")).toBeInTheDocument();
  });
  it("requests the next page using the server cursor", async () => {
    const fetchList = vi
      .spyOn(workspaceAi, "operations")
      .mockImplementation(async (_, q) => ({
        items: q.has("cursor") ? [] : [row],
        nextCursor: q.has("cursor") ? null : "second",
      }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() =>
      expect(
        fetchList.mock.calls.some(([, q]) => q.get("cursor") === "second"),
      ).toBe(true),
    );
  });
});
