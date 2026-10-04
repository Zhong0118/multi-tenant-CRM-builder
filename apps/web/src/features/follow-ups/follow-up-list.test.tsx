import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowUpList } from "./follow-up-list";
import { followUpApi } from "./follow-up-api";

const navigation = vi.hoisted(() => ({ search: "status=DONE&page=3", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/workspace/northwind/follow-ups",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("./follow-up-api", async (original) => ({ ...await original<typeof import("./follow-up-api")>(), followUpApi: {
  list: vi.fn(), create: vi.fn(), update: vi.fn(), recipients: vi.fn(), workbench: vi.fn(),
} }));
const task = { id: "task-1", recordId: "record-1", objectCode: "orders", objectName: "订单", recordTitle: "订单 A", title: "确认反馈", dueAt: "2026-10-04T00:00:00Z", status: "DONE", version: 3, overdue: false, canManage: true };
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FollowUpList tenantCode="northwind" /></QueryClientProvider>);
}
beforeEach(() => {
  navigation.search = "status=DONE&page=3";
  navigation.replace.mockReset();
  vi.mocked(followUpApi.list).mockReset().mockImplementation(async (_tenant, query) => ({ items: [task], total: 61, limit: 20, page: query.page ?? 1, openCount: 0, overdueCount: 0 }));
});
describe("follow-up list URL state", () => {
  it("reads direct URL state and carries it with the exact task to detail", async () => {
    mount();
    const link = await screen.findByRole("link", { name: "订单 A · 订单" });
    expect(followUpApi.list).toHaveBeenLastCalledWith("northwind", { recordId: undefined, status: "DONE", page: 3, limit: 20 });
    expect(screen.getByRole("radio", { name: "已完成" })).toBeChecked();
    expect(link).toHaveAttribute("href", "/workspace/northwind/objects/orders/record-1?followUp=task-1&returnTo=%2Fworkspace%2Fnorthwind%2Ffollow-ups%3Fstatus%3DDONE%26page%3D3");
    fireEvent.click(screen.getByRole("radio", { name: "已逾期" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/workspace/northwind/follow-ups?status=OVERDUE&page=1", { scroll: false });
  });
  it("tracks back navigation and changes page without losing status", async () => {
    const view = mount();
    await screen.findByText("确认反馈");
    fireEvent.click(screen.getByTitle("4"));
    expect(navigation.replace).toHaveBeenLastCalledWith("/workspace/northwind/follow-ups?status=DONE&page=4", { scroll: false });
    navigation.search = "status=CANCELLED&page=2";
    view.rerender(<QueryClientProvider client={new QueryClient()}><FollowUpList tenantCode="northwind" /></QueryClientProvider>);
    await waitFor(() => expect(followUpApi.list).toHaveBeenLastCalledWith("northwind", { recordId: undefined, status: "CANCELLED", page: 2, limit: 20 }));
    expect(screen.getByRole("radio", { name: "已取消" })).toBeChecked();
  });
  it("keeps the selected status and page on request failure and retry", async () => {
    vi.mocked(followUpApi.list).mockRejectedValueOnce(new Error("unavailable"));
    mount();
    await screen.findByText("待办暂时无法加载");
    expect(screen.getByRole("radio", { name: "已完成" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await screen.findByText("确认反馈");
    expect(followUpApi.list).toHaveBeenLastCalledWith("northwind", { recordId: undefined, status: "DONE", page: 3, limit: 20 });
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
