import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PlatformOverview } from "./platform-overview";

const statuses = ["DRAFT", "SUSPENDED", "CLOSED", "DRAFT"] as const;

const eightTenants = Array.from({ length: 8 }, (_, index) => ({
  id: `tenant-${index + 1}`,
  name: `公司 ${index + 1}`,
  code: `company-${index + 1}`,
  status: statuses[index % 4],
  activeAdminCount: index,
  createdAt: "2026-08-01T00:00:00.000Z",
}));

describe("PlatformOverview", () => {
  it("shows an empty state instead of zero KPI cards", () => {
    render(
      <PlatformOverview
        summary={{ total: 0, draft: 0, active: 0, suspended: 0, closed: 0 }}
        tenants={{ items: [], page: 1, limit: 8, total: 0 }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "平台总览" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "新增公司" })[0],
    ).toHaveAttribute("href", "/platform/tenants/new");
    expect(screen.queryByText("公司总数")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "还没有公司" })).toHaveAttribute(
      "data-surface",
      "reading",
    );
  });

  it("renders four status counts and at most eight companies", () => {
    render(
      <PlatformOverview
        summary={{ total: 12, draft: 2, active: 7, suspended: 2, closed: 1 }}
        tenants={{ items: eightTenants, page: 1, limit: 8, total: 12 }}
      />,
    );
    expect(screen.getByText("公司总数")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute(
      "href",
      "/platform/tenants",
    );
    expect(screen.getAllByRole("row")).toHaveLength(9); // header + 8
    expect(screen.queryByText("今日新增记录")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "最近开通的公司" }),
    ).toHaveAttribute("data-surface", "data");
  });

  it("keeps zero counts quiet and names the latest real change", () => {
    const { container } = render(
      <PlatformOverview
        summary={{ total: 3, draft: 0, active: 3, suspended: 0, closed: 0 }}
        tenants={{ items: [], page: 1, limit: 8, total: 3 }}
        latestChange={{
          id: "audit-1",
          tenantId: "tenant-1",
          tenantName: "星云科技",
          actorType: "USER",
          actorId: "user-1",
          actorName: "刘洋",
          action: "follow_up.completed",
          resourceType: "record_follow_up",
          resourceId: "follow-1",
          before: null,
          after: null,
          reason: null,
          requestId: "req-1",
          ip: null,
          createdAt: "2026-10-24T08:54:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("没有待开通的草稿公司")).toBeInTheDocument();
    expect(screen.getByText("没有暂停的公司")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /家暂停公司/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /最近一次变更/ }),
    ).toHaveTextContent("星云科技 · 刘洋 完成跟进，10/24 16:54");
    // Only the running count is highlighted.
    expect(
      container.querySelectorAll("[class*='kpiDanger'], [class*='kpiWarning']"),
    ).toHaveLength(0);
  });

  it("says when the latest change could not be read", () => {
    render(
      <PlatformOverview
        summary={{ total: 1, draft: 1, active: 0, suspended: 0, closed: 0 }}
        tenants={{ items: [], page: 1, limit: 8, total: 1 }}
        latestChange="unavailable"
      />,
    );
    expect(screen.getByRole("link", { name: /暂时无法读取/ })).toHaveAttribute(
      "href",
      "/platform/audit",
    );
  });
});
