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
  });
});
