import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { NotificationBell } from "./notification-bell";
import type { NotificationsApi, NotificationPage } from "./notification-api";

const snapshot: NotificationPage = {
  items: [{ id: "n1", kind: "TASK_OVERDUE", title: "待办已逾期", message: "请及时处理待办", createdAt: "2026-10-19T00:00:00Z", dueAt: null, readAt: null, canOpen: true }],
  total: 21, unreadCount: 3, page: 1, limit: 20, serverTime: "2026-10-19T01:00:00Z", snapshot: "100:110:101",
};
function createApi(): NotificationsApi {
  return { list: vi.fn().mockResolvedValue(snapshot), read: vi.fn().mockResolvedValue({ ok: true }), readAll: vi.fn().mockResolvedValue({ ok: true }), target: vi.fn().mockResolvedValue({ href: "/workspace/a/tasks" }) };
}
async function open() { fireEvent.click(screen.getByLabelText(/打开消息/)); await screen.findByText("请及时处理待办"); }

describe("NotificationBell", () => {
  it("shows daily goal reminders and opens the member's progress", async () => {
    const api = createApi();
    vi.mocked(api.list).mockResolvedValue({ ...snapshot, items: [{ ...snapshot.items[0], kind: "WORK_GOAL_BEHIND", title: "电话目标未达成", message: "今日已完成 2 / 10" }] });
    vi.mocked(api.target).mockResolvedValue({ href: "/workspace/a/work" });
    const onNavigate = vi.fn();
    render(<NotificationBell tenantCode="a" api={api} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByLabelText("打开消息，3 条未读"));
    await screen.findByText("今日已完成 2 / 10");
    expect(screen.getByText("目标提醒")).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看目标"));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/workspace/a/work"));
  });
  it("shows unread count and opens grouped notifications", async () => {
    render(<NotificationBell tenantCode="a" api={createApi()} />);
    await screen.findByLabelText("打开消息，3 条未读");
    await open();
    expect(screen.getByText("待办提醒")).toBeInTheDocument();
    expect(screen.getByText("全部已读")).toBeInTheDocument();
  });
  it("preserves a visible error and lets the user retry", async () => {
    const api = createApi(); vi.mocked(api.list).mockRejectedValueOnce(new Error("offline"));
    render(<NotificationBell tenantCode="a" api={api} />);
    await screen.findByLabelText("打开消息，读取失败");
    fireEvent.click(screen.getByLabelText("打开消息，读取失败"));
    fireEvent.click(await screen.findByLabelText("重试"));
    await screen.findByText("请及时处理待办");
  });
  it("marks one message and refreshes unread count", async () => {
    const api = createApi(); render(<NotificationBell tenantCode="a" api={api} />); await open();
    vi.mocked(api.list).mockResolvedValue({ ...snapshot, unreadCount: 2, items: [{ ...snapshot.items[0], readAt: snapshot.serverTime }] });
    fireEvent.click(screen.getByText("标为已读"));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("a", "n1"));
    await screen.findByLabelText("打开消息，2 条未读");
  });
  it("marks all only through the displayed server snapshot", async () => {
    const api = createApi(); render(<NotificationBell tenantCode="a" api={api} />); await open();
    fireEvent.click(screen.getByText("全部已读"));
    await waitFor(() => expect(api.readAll).toHaveBeenCalledWith("a", snapshot.serverTime, snapshot.snapshot));
  });
  it.each(["/workspace/a/tasks", null])("rechecks a target before navigation (%s)", async (href) => {
    const api = createApi(); vi.mocked(api.target).mockResolvedValue({ href }); const onNavigate = vi.fn();
    render(<NotificationBell tenantCode="a" api={api} onNavigate={onNavigate} />); await open();
    fireEvent.click(screen.getByText("查看记录"));
    await waitFor(() => expect(api.target).toHaveBeenCalledWith("a", "n1"));
    expect(api.read).toHaveBeenCalledWith("a", "n1");
    if (href) await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(href));
    else { await screen.findByText("相关记录已失效或你已无权访问"); expect(onNavigate).not.toHaveBeenCalled(); }
  });
  it("refreshes the current filter after a delayed single-read action", async () => {
    const api = createApi();
    let finishRead: ((value: { ok: true }) => void) | undefined;
    vi.mocked(api.read).mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    vi.mocked(api.list).mockImplementation(async (_tenant, query) => ({ ...snapshot, items: [{ ...snapshot.items[0], message: query.unreadOnly ? "当前未读列表" : "请及时处理待办" }] }));
    render(<NotificationBell tenantCode="a" api={api} />); await open();
    fireEvent.click(screen.getByText("标为已读"));
    fireEvent.click(screen.getByText("未读", { selector: ".ant-segmented-item-label" }));
    await screen.findByText("当前未读列表");
    await act(async () => { finishRead?.({ ok: true }); });
    expect(api.list).toHaveBeenLastCalledWith("a", { page: 1, limit: 20, unreadOnly: true });
    expect(screen.getByText("当前未读列表")).toBeInTheDocument();
    expect(screen.queryByText("请及时处理待办")).not.toBeInTheDocument();
  });
  it("refreshes the current page after a delayed read-all action", async () => {
    const api = createApi();
    let finishRead: ((value: { ok: true }) => void) | undefined;
    vi.mocked(api.readAll).mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    vi.mocked(api.list).mockImplementation(async (_tenant, query) => ({ ...snapshot, page: query.page, items: [{ ...snapshot.items[0], message: query.page === 2 ? "当前第二页" : "请及时处理待办" }] }));
    render(<NotificationBell tenantCode="a" api={api} />); await open();
    fireEvent.click(screen.getByText("全部已读"));
    fireEvent.click(screen.getByTitle("Next Page"));
    await screen.findByText("当前第二页");
    await act(async () => { finishRead?.({ ok: true }); });
    expect(api.list).toHaveBeenLastCalledWith("a", { page: 2, limit: 20, unreadOnly: false });
    expect(screen.getByText("当前第二页")).toBeInTheDocument();
  });
  it.each(["switch", "unmount"])("does not continue an old read action after %s", async (change) => {
    const api = createApi(); const onNavigate = vi.fn();
    let finishRead: ((value: { ok: true }) => void) | undefined;
    vi.mocked(api.read).mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const view = render(<NotificationBell tenantCode="a" api={api} onNavigate={onNavigate} />); await open();
    fireEvent.click(screen.getByText("查看记录"));
    if (change === "switch") {
      vi.mocked(api.list).mockResolvedValue({ ...snapshot, unreadCount: 7, items: [] });
      view.rerender(<NotificationBell tenantCode="b" api={api} onNavigate={onNavigate} />);
      await screen.findByLabelText("打开消息，7 条未读");
    } else view.unmount();
    const listCount = vi.mocked(api.list).mock.calls.length;
    await act(async () => { finishRead?.({ ok: true }); });
    expect(api.list).toHaveBeenCalledTimes(listCount);
    expect(api.target).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
    if (change === "switch") expect(screen.getByLabelText("打开消息，7 条未读")).toBeInTheDocument();
  });
  it("resets pagination, filter and old company content on tenant change", async () => {
    const api = createApi(); const { rerender } = render(<NotificationBell tenantCode="a" api={api} />); await open();
    fireEvent.click(screen.getByTitle("Next Page"));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("a", { page: 2, limit: 20, unreadOnly: false }));
    vi.mocked(api.list).mockImplementation(() => new Promise(() => {}));
    rerender(<NotificationBell tenantCode="b" api={api} />);
    expect(screen.queryByText("请及时处理待办")).not.toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("b", { page: 1, limit: 20, unreadOnly: false }));
  });
  it("limits the drawer to a narrow viewport and switches the unread filter", async () => {
    const api = createApi();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<NotificationBell tenantCode="a" api={api} />); await open();
    const wrapper = document.querySelector(".ant-drawer-content-wrapper");
    expect((wrapper as HTMLElement).style.maxWidth).toBe("100vw");
    fireEvent.click(screen.getByText("未读", { selector: ".ant-segmented-item-label" }));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("a", { page: 1, limit: 20, unreadOnly: true }));
  });
  it("ignores a previous company's response after switching", async () => {
    const api = createApi();
    let finishOld: ((value: NotificationPage) => void) | undefined;
    vi.mocked(api.list).mockImplementation((tenant) => tenant === "a" ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve({ ...snapshot, unreadCount: 7, items: [] }));
    const { rerender } = render(<NotificationBell tenantCode="a" api={api} />);
    rerender(<NotificationBell tenantCode="b" api={api} />);
    await screen.findByLabelText("打开消息，7 条未读");
    await act(async () => { finishOld?.(snapshot); });
    expect(screen.getByLabelText("打开消息，7 条未读")).toBeInTheDocument();
  });
  it("keeps read failures actionable without navigating", async () => {
    const api = createApi(); vi.mocked(api.read).mockRejectedValue(new Error("offline"));
    const onNavigate = vi.fn(); render(<NotificationBell tenantCode="a" api={api} onNavigate={onNavigate} />); await open();
    fireEvent.click(screen.getByText("查看记录"));
    await screen.findByText("操作失败，请重试");
    expect(api.target).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText("查看记录").closest("button")).not.toBeDisabled();
  });
  it("does not show workspace notifications without a tenant", () => {
    const api = createApi(); render(<NotificationBell tenantCode="" api={api} />);
    expect(screen.queryByLabelText(/打开消息/)).not.toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });
  it("pauses hidden-tab polling and refreshes when visible", async () => {
    const api = createApi(); render(<NotificationBell tenantCode="a" api={api} />);
    await screen.findByLabelText("打开消息，3 条未读");
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(api.list).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(api.list).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
