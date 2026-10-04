import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { RecordActivityTimeline } from "./record-activity-timeline";
import type { RecordApi } from "./record-api";

const existing = {
  id: "activity-1",
  activityType: "NOTE" as const,
  content: "第一次电话未接通。",
  nextActionAt: null,
  actorMemberId: "member-lin",
  actorDisplayName: "林晨",
  createdAt: "2026-08-21T02:00:00.000Z",
};

function recordApi(overrides: Partial<RecordApi> = {}): RecordApi {
  return {
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listActivities: vi.fn().mockResolvedValue({
      items: [existing],
      page: 1,
      limit: 20,
      total: 1,
    }),
    createActivity: vi.fn().mockResolvedValue({
      ...existing,
      id: "activity-2",
      content: "已回访确认需求。",
    }),
    export: vi.fn(),
    batchUpdate: vi.fn(),
    importRows: vi.fn(),
    ...overrides,
  };
}

function renderTimeline(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RecordActivityTimeline", () => {
  it("lists existing activities in the record detail", async () => {
    renderTimeline(
      <RecordActivityTimeline
        tenantCode="northwind"
        objectCode="customers"
        recordId="record-1"
        canCreate
        api={recordApi()}
      />,
    );

    expect(await screen.findByText("第一次电话未接通。")).toBeInTheDocument();
    expect(screen.getByText("林晨")).toBeInTheDocument();
  });

  it("appends a new activity without offering an edit action", async () => {
    const api = recordApi();
    renderTimeline(
      <RecordActivityTimeline
        tenantCode="northwind"
        objectCode="customers"
        recordId="record-1"
        canCreate
        api={api}
      />,
    );

    expect(screen.queryByLabelText("内容")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "追加活动" }));
    fireEvent.change(await screen.findByLabelText("内容"), {
      target: { value: "已回访确认需求。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存活动" }));

    await waitFor(() =>
      expect(api.createActivity).toHaveBeenCalledWith(
        "northwind",
        "customers",
        "record-1",
        { activityType: "NOTE", content: "已回访确认需求。" },
      ),
    );
    expect(screen.queryByRole("button", { name: "编辑跟进" })).not.toBeInTheDocument();
  });

  it("retains an activity draft after failure and while the form is collapsed", async () => {
    const api = recordApi({ createActivity: vi.fn().mockRejectedValue(new Error("network unavailable")) });
    renderTimeline(<RecordActivityTimeline tenantCode="northwind" objectCode="customers" recordId="record-1" canCreate api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "追加活动" }));
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "待保存的拜访记录" } });
    fireEvent.click(screen.getByRole("button", { name: "保存活动" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("内容")).toHaveValue("待保存的拜访记录");
    fireEvent.click(screen.getByRole("button", { name: "收起表单" }));
    fireEvent.click(screen.getByRole("button", { name: "追加活动" }));
    expect(screen.getByLabelText("内容")).toHaveValue("待保存的拜访记录");
  });

  it("hides the composer when the member cannot update the record", async () => {
    renderTimeline(
      <RecordActivityTimeline
        tenantCode="northwind"
        objectCode="customers"
        recordId="record-1"
        canCreate={false}
        api={recordApi()}
      />,
    );

    expect(await screen.findByText("第一次电话未接通。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存活动" })).not.toBeInTheDocument();
    expect(
      screen.getByText("当前权限只能查看活动历史，不能追加。"),
    ).toBeInTheDocument();
  });
});
