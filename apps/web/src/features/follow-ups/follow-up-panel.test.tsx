import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FollowUpPanel } from "./follow-up-panel";
import type { followUpApi, FollowUp, FollowUpPage } from "./follow-up-api";

const task: FollowUp = {
  id: "task-1",
  recordId: "record-1",
  objectCode: "opportunities",
  objectName: "商机",
  recordTitle: "项目 A",
  title: "确认客户反馈",
  dueAt: "2026-09-08T02:00:00.000Z",
  status: "OPEN",
  version: 3,
  overdue: true,
  canManage: true,
};
function setup(items: FollowUp[] = [], canCreate = true) {
  const page: FollowUpPage = {
    items,
    total: items.length,
    page: 1,
    limit: 5,
    openCount: items.length,
    overdueCount: items.filter((t) => t.overdue).length,
  };
  const api = {
    recipients: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue(page),
    create: vi.fn().mockResolvedValue(task),
    update: vi.fn().mockResolvedValue(task),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FollowUpPanel
        tenantCode="northwind"
        record={{ id: "record-1", objectCode: "opportunities", canCreate }}
        api={api as typeof followUpApi}
      />
    </QueryClientProvider>,
  );
  return api;
}

describe("FollowUpPanel", () => {
  it("keeps unsaved input available after a failed creation", async () => {
    const api = setup();
    api.create.mockRejectedValueOnce(new Error("network unavailable"));
    fireEvent.change(screen.getByLabelText("跟进事项"), {
      target: { value: "确认方案" },
    });
    fireEvent.change(screen.getByLabelText("下次跟进时间（本地时间）"), {
      target: { value: "2026-09-08T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "安排跟进" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("跟进事项")).toHaveValue("确认方案");
    expect(screen.getByLabelText("下次跟进时间（本地时间）")).toHaveValue(
      "2026-09-08T10:00",
    );
  });

  it("switches the query to overdue rather than filtering just the loaded page", async () => {
    const api = setup();
    await screen.findByText("暂无待跟进事项，从业务记录详情安排下一步。");
    fireEvent.click(screen.getByRole("radio", { name: "已逾期" }));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith("northwind", {
        recordId: "record-1",
        status: "OVERDUE",
        page: 1,
        limit: 5,
      }),
    );
    expect(await screen.findByText("目前没有逾期事项")).toBeInTheDocument();
  });

  it("accepts a native local datetime change, enables creation and submits its UTC instant", async () => {
    const api = setup();
    const submit = screen.getByRole("button", { name: "安排跟进" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("跟进事项"), {
      target: { value: "  确认方案  " },
    });
    expect(submit).toBeDisabled();
    const date = screen.getByLabelText("下次跟进时间（本地时间）");
    fireEvent.change(date, { target: { value: "2026-09-08T10:00" } });
    expect(date).toHaveValue("2026-09-08T10:00");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("northwind", {
        objectCode: "opportunities",
        recordId: "record-1",
        title: "确认方案",
        dueAt: new Date("2026-09-08T10:00").toISOString(),
      }),
    );
    await waitFor(() => expect(date).toHaveValue(""));
    expect(screen.getByLabelText("跟进事项")).toHaveValue("");
    expect(submit).toBeDisabled();
  });

  it("hides writes when the record or task is read only", async () => {
    setup([{ ...task, canManage: false }], false);
    await screen.findByText("确认客户反馈");
    expect(screen.queryByLabelText("跟进事项")).not.toBeInTheDocument();
    for (const name of [/完\s*成/, /改\s*期/, /取\s*消/])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("completes the observed task version and refreshes its query", async () => {
    const api = setup([task]);
    fireEvent.click(await screen.findByRole("button", { name: /完\s*成/ }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
        version: 3,
        status: "DONE",
      }),
    );
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("reschedules with the current version and disables saving an empty date", async () => {
    const api = setup([task]);
    fireEvent.click(await screen.findByRole("button", { name: /改\s*期/ }));
    const date = await screen.findByLabelText("新的跟进时间（本地时间）");
    fireEvent.change(date, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "保存时间" })).toBeDisabled();
    fireEvent.change(date, { target: { value: "2026-09-10T11:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存时间" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
        version: 3,
        dueAt: new Date("2026-09-10T11:30").toISOString(),
      }),
    );
  });

  it("requires explicit confirmation to cancel a task", async () => {
    const api = setup([task]);
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认取消" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("northwind", "task-1", {
        version: 3,
        status: "CANCELLED",
      }),
    );
  });
});
