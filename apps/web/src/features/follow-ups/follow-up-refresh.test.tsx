import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FollowUpPanel } from "./follow-up-panel";
import { PersonalFollowUpWorkbench } from "./follow-up-workbench";
import { followUpQueryKeys, type followUpApi, type FollowUp, type FollowUpPage } from "./follow-up-api";

vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/northwind", useSearchParams: () => new URLSearchParams() }));
const task = { id: "task-1", recordId: "record-1", objectCode: "orders", objectName: "订单", recordTitle: "订单 A", title: "确认反馈", dueAt: "2026-10-04T00:00:00Z", status: "OPEN" as const, version: 7, overdue: false, canManage: true, assigneeMemberId: "member-1", assigneeName: "成员" } satisfies FollowUp;

describe("shared follow-up refresh", () => {
  it.each(["create", "complete", "reschedule", "cancel"] as const)("awaits %s refresh for both live observers and invalidates an inactive return", async (operation) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    let changed = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const page = async (limit: number): Promise<FollowUpPage> => {
      if (changed) await gate;
      return { items: changed ? [] : [task], total: changed ? 0 : 1, page: 1, limit, openCount: changed ? 0 : 1, overdueCount: 0 };
    };
    const api = {
      list: vi.fn(async (_tenant, query) => page(query.limit ?? 20)),
      workbench: vi.fn(async () => {
        if (changed) await gate;
        return { timezone: "Asia/Shanghai", counts: { allOpen: changed ? 0 : 1, overdue: 0, today: changed ? 0 : 1, upcoming: 0 }, preview: { overdue: [], today: changed ? [] : [task], upcoming: [] } };
      }),
      create: vi.fn(async () => { changed = true; return task; }),
      update: vi.fn(async () => { changed = true; return task; }),
      recipients: vi.fn(async () => []),
    } satisfies typeof followUpApi;
    const inactiveKey = [...followUpQueryKeys.root("northwind"), undefined, "OPEN", 1];
    await client.fetchQuery({ queryKey: inactiveKey, queryFn: () => page(20) });
    const view = render(<QueryClientProvider client={client}>
      <FollowUpPanel tenantCode="northwind" record={{ id: "record-1", objectCode: "orders", canCreate: true }} api={api} />
      <PersonalFollowUpWorkbench tenantCode="northwind" api={api} />
    </QueryClientProvider>);
    const panel = screen.getByRole("region", { name: "下一步跟进" });
    await screen.findByTestId("workbench-count-all");
    await within(panel).findByText("确认反馈");
    if (operation === "create") {
      fireEvent.click(within(panel).getByRole("button", { name: "安排跟进" }));
      fireEvent.change(screen.getByLabelText("跟进事项"), { target: { value: "  新事项  " } });
      fireEvent.change(screen.getByLabelText("下次跟进时间（本地时间）"), { target: { value: "2026-10-05T10:30" } });
      fireEvent.click(within(panel).getByRole("button", { name: "安排跟进" }));
      await waitFor(() => expect(api.create).toHaveBeenCalledWith("northwind", { objectCode: "orders", recordId: "record-1", title: "新事项", dueAt: new Date("2026-10-05T10:30").toISOString() }));
    } else if (operation === "reschedule") {
      fireEvent.click(within(panel).getByRole("button", { name: /改\s*期/ }));
      fireEvent.change(await screen.findByLabelText("新的跟进时间（本地时间）"), { target: { value: "2026-10-05T10:30" } });
      fireEvent.click(screen.getByRole("button", { name: "保存时间" }));
      await waitFor(() => expect(api.update).toHaveBeenCalledWith("northwind", "task-1", { version: 7, dueAt: new Date("2026-10-05T10:30").toISOString() }));
    } else {
      fireEvent.click(within(panel).getByRole("button", { name: operation === "complete" ? /完\s*成/ : "取消" }));
      if (operation === "cancel") fireEvent.click(await screen.findByRole("button", { name: "确认取消" }));
      await waitFor(() => expect(api.update).toHaveBeenCalledWith("northwind", "task-1", { version: 7, status: operation === "complete" ? "DONE" : "CANCELLED" }));
    }
    await waitFor(() => expect(client.getQueryState(followUpQueryKeys.workbench("northwind"))?.fetchStatus).toBe("fetching"));
    // While both refetches are held, the task action must remain pending.
    if (operation === "create") expect(within(panel).getByRole("button", { name: "收起表单" })).toBeDisabled();
    else expect(within(panel).getByRole("button", { name: /完\s*成/ })).toBeDisabled();
    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    await act(async () => { release(); await gate; });
    await waitFor(() => expect(screen.getByTestId("workbench-count-all")).toHaveTextContent("0"));
    await waitFor(() => expect(within(panel).queryByText("确认反馈")).not.toBeInTheDocument());
    expect(client.getQueryData<FollowUpPage>(inactiveKey)?.items).toEqual([]);
    const returning = new QueryObserver(client, { queryKey: inactiveKey, queryFn: () => page(20), staleTime: Infinity });
    const unsubscribe = returning.subscribe(() => {});
    await waitFor(() => expect(client.getQueryData<FollowUpPage>(inactiveKey)?.items).toEqual([]));
    unsubscribe();
    view.unmount();
    client.clear();
  });
});
