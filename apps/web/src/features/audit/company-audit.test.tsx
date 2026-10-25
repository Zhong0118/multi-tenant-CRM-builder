import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CompanyAuditView } from "./company-audit";

describe("CompanyAuditView", () => {
  it("shows system fields readably and business fields as labelled", () => {
    render(
      <CompanyAuditView
        basePath="/workspace/nebula/audit"
        filters={{}}
        members={[]}
        data={{
          page: 1,
          limit: 20,
          total: 1,
          timezone: "Asia/Shanghai",
          items: [
            {
              id: "audit-1",
              actorType: "USER",
              actorId: "user-1",
              actorName: "孙悦",
              action: "follow_up.completed",
              resourceType: "record_follow_up",
              resourceId: "follow-1",
              resourceName: "核对采购数量回电",
              before: { status: "OPEN", dueAt: "2026-10-24T02:00:00.000Z" },
              after: { status: "DONE", dueAt: "2026-10-24T02:00:00.000Z" },
              changes: [
                { key: "status", before: "OPEN", after: "DONE" },
                { key: "amount", label: "金额", before: 100, after: 120 },
              ],
              requestId: "req-1",
              createdAt: "2026-10-24T08:50:00.000Z",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /孙悦/ }));
    const changes = within(screen.getByRole("dialog")).getByRole("table");
    expect(within(changes).getByText("状态")).toBeInTheDocument();
    expect(within(changes).getByText("待跟进")).toBeInTheDocument();
    expect(within(changes).getByText("已完成")).toBeInTheDocument();
    expect(within(changes).getByText("金额")).toBeInTheDocument();
    expect(within(changes).getByText("120")).toBeInTheDocument();
  });
});
