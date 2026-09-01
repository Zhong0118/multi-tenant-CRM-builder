import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardRuntime, DashboardRuntimeResult } from "@/features/dashboard/dashboard-types";

import { WorkspaceHomeView } from "./workspace-home-view";

vi.mock("@ant-design/charts", () => ({
  Bar: () => <div data-testid="distribution-chart" />,
  Line: () => <div data-testid="trend-chart" />,
}));

const objects = [
  {
    code: "orders",
    name: "订单",
    icon: null,
    sortOrder: 10,
    canCreate: true,
    canRead: true,
    canUpdate: true,
  },
];

describe("WorkspaceHomeView", () => {
  it("renders published widgets in configured order and widths", () => {
    const { container } = render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={readyOverview}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "八月运营概览" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "订单总数" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "处理状态" })).toBeInTheDocument();
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "负责人排行" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "北区订单" })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/orders/record-1",
    );

    const widgets = container.querySelectorAll("[data-dashboard-widget]");
    expect([...widgets].map((widget) => widget.getAttribute("data-widget-id"))).toEqual([
      "total",
      "status",
      "trend",
      "leaderboard",
      "records",
      "unavailable",
    ]);
    expect([...widgets[0].classList].some((name) => name.includes("widgetQuarter"))).toBe(true);
    expect([...widgets[1].classList].some((name) => name.includes("widgetHalf"))).toBe(true);
    expect([...widgets[4].classList].some((name) => name.includes("widgetFull"))).toBe(true);
  });

  it("keeps ready siblings visible when one published widget is unavailable", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={readyOverview}
      />,
    );

    expect(screen.getByRole("heading", { name: "负责人排行" })).toBeInTheDocument();
    expect(screen.getByText("此组件暂时无法显示")).toBeInTheDocument();
    expect(screen.getByText("查询暂时不可用，请稍后重试。")).toBeInTheDocument();
  });

  it("offers administrators configuration while employees see not-enabled guidance", () => {
    const { rerender } = render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={emptyOverview("TENANT_ADMIN")}
      />,
    );

    expect(screen.getByRole("link", { name: "配置工作台" })).toHaveAttribute(
      "href",
      "/workspace/northwind/settings/dashboard",
    );

    rerender(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="李明"
        role="EMPLOYEE"
        businessObjects={objects}
        overview={emptyOverview("EMPLOYEE")}
      />,
    );

    expect(screen.getByText("工作台尚未启用")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "配置工作台" })).not.toBeInTheDocument();
  });
});

const runtime = {
  title: "八月运营概览",
  period: {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-31T00:00:00.000Z",
    timezone: "Asia/Shanghai",
  },
  widgets: [
    {
      id: "total",
      type: "METRIC",
      title: "订单总数",
      objectCode: "orders",
      width: "QUARTER",
      sortOrder: 1,
      state: "READY",
      data: { value: 12, format: "NUMBER" },
    },
    {
      id: "status",
      type: "STATUS_DISTRIBUTION",
      title: "处理状态",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 2,
      state: "READY",
      data: {
        display: "BAR",
        items: [
          { optionKey: "open", label: "待处理", color: "BLUE", value: 8 },
          { optionKey: "done", label: "已完成", color: "GREEN", value: 4 },
        ],
      },
    },
    {
      id: "trend",
      type: "TREND",
      title: "每日订单",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 3,
      state: "READY",
      data: { items: [{ date: "2026-08-20", value: 2 }] },
    },
    {
      id: "leaderboard",
      type: "LEADERBOARD",
      title: "负责人排行",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 4,
      state: "READY",
      data: { items: [{ memberId: "member-1", displayName: "王芳", value: 3 }] },
    },
    {
      id: "records",
      type: "RECORD_LIST",
      title: "近期订单",
      objectCode: "orders",
      width: "FULL",
      sortOrder: 5,
      state: "READY",
      data: {
        fields: [{ fieldKey: "status", label: "处理状态", type: "SINGLE_SELECT" }],
        items: [
          {
            id: "record-1",
            recordNo: "ORD-001",
            title: "北区订单",
            ownerMemberId: "member-1",
            ownerName: "王芳",
            updatedAt: "2026-08-30T00:00:00.000Z",
            values: { status: "待处理" },
          },
        ],
      },
    },
    {
      id: "unavailable",
      type: "METRIC",
      title: "无法读取的指标",
      objectCode: "orders",
      width: "QUARTER",
      sortOrder: 6,
      state: "UNAVAILABLE",
      reason: "QUERY_FAILED",
    },
  ],
} satisfies DashboardRuntime;

const readyOverview = {
  ...runtime,
  state: "READY",
  role: "TENANT_ADMIN",
} satisfies DashboardRuntimeResult;

function emptyOverview(role: DashboardRuntimeResult["role"]): DashboardRuntimeResult {
  return {
    title: "工作台",
    period: runtime.period,
    widgets: [],
    state: "UNCONFIGURED",
    role,
  };
}
