import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardRenderer } from "./dashboard-renderer";
import type { DashboardRuntime } from "./dashboard-types";
vi.mock("@ant-design/charts", () => ({ Bar: () => null, Line: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/northwind/dashboards/sales", useSearchParams: () => new URLSearchParams("from=2026-10-01&to=2026-10-04") }));
describe("dashboard record source links", () => {
  it("returns a record-list detail to the exact named dashboard range", () => {
    render(<DashboardRenderer tenantCode="northwind" runtime={{ title: "销售", period: { from: "2026-10-01", to: "2026-10-04", timezone: "Asia/Shanghai" }, widgets: [{ id: "records", type: "RECORD_LIST", title: "订单", state: "READY", objectCode: "orders", width: "FULL", sortOrder: 1, data: { fields: [], items: [{ id: "r1", recordNo: "1", title: "订单 A", ownerMemberId: null, ownerName: null, updatedAt: "2026-10-04T00:00:00Z", values: {} }] } }] } as DashboardRuntime} />);
    expect(screen.getByRole("link", { name: "订单 A" })).toHaveAttribute("href", "/workspace/northwind/objects/orders/r1?returnTo=%2Fworkspace%2Fnorthwind%2Fdashboards%2Fsales%3Ffrom%3D2026-10-01%26to%3D2026-10-04");
  });
});

it("explains an archived widget while rendering other live results", () => {
  render(<DashboardRenderer tenantCode="northwind" runtime={{ title: "销售", period: { from: "2026-10-01", to: "2026-10-20", timezone: "Asia/Shanghai" }, widgets: [
    { id: "archived", type: "METRIC", title: "停用客户", state: "UNAVAILABLE", reason: "OBJECT_ARCHIVED", objectCode: "customers", width: "HALF", sortOrder: 0 },
    { id: "live", type: "METRIC", title: "现有订单", state: "READY", objectCode: "orders", width: "HALF", sortOrder: 1, data: { value: 7 } },
  ] } as DashboardRuntime} />);
  expect(screen.getByText("引用的业务表已停用，恢复后可继续查看。")).toBeInTheDocument();
  expect(screen.getByText("7")).toBeInTheDocument();
});
