import { render, screen, within } from "@testing-library/react";
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
  it("renders published widgets in type bands, ignoring configured widths", () => {
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
      "unavailable",
      "trend",
      "status",
      "leaderboard",
      "records",
    ]);
    expect(container.querySelector('[data-dashboard-band="metrics"]')).toContainElement(
      widgets[0] as HTMLElement,
    );
    expect(container.querySelector('[data-dashboard-band="analysis"]')).toContainElement(
      screen.getByRole("heading", { name: "每日订单" }),
    );
    expect(container.querySelector('[data-dashboard-band="tables"]')).toContainElement(
      screen.getByRole("heading", { name: "近期订单" }),
    );
    expect([...widgets].some((widget) =>
      [...widget.classList].some((name) =>
        name.includes("widgetQuarter") ||
        name.includes("widgetHalf") ||
        name.includes("widgetFull"),
      ),
    )).toBe(false);
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

  it("renders each ready widget's empty result without inventing values", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={emptyWidgetOverview}
      />,
    );

    expect(screen.getByRole("heading", { name: "空指标" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("当前范围没有数据")).toHaveLength(4);
  });

  it("renders funnel and donut distributions as distinct accessible displays", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={distributionOverview}
      />,
    );

    expect(screen.getByRole("list", { name: "阶段漏斗" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "阶段环图" })).toBeInTheDocument();
    expect(screen.getByText("未知颜色").previousElementSibling).toHaveStyle({
      backgroundColor: "rgb(124, 137, 146)",
    });
  });

  it("renders zero and negative distribution values without presenting them as positive shares", () => {
    const { container } = render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
        overview={signedDistributionOverview}
      />,
    );

    expect(screen.getAllByText("零值")).toHaveLength(2);
    expect(screen.getAllByText("-4")).toHaveLength(3);
    expect(
      container.querySelector('[data-distribution-mark][data-direction="zero"]'),
    ).toHaveStyle({ width: "0%" });
    expect(
      container.querySelector('[data-funnel-stage][data-direction="zero"]'),
    ).toHaveStyle({ width: "0%" });
    expect(screen.getByLabelText("负向阶段：-4，负值")).toBeInTheDocument();
    expect(screen.getByText("存在负值，无法按整体比例展示。")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "含负值环图" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "全零环图" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "全零环图数值" })).toHaveTextContent("零值0");
  });

  it("provides a textual trend-data equivalent alongside the concise chart", () => {
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

    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    const dataTable = screen.getByRole("table", { name: "每日订单数据" });
    expect(within(dataTable).getByRole("cell", { name: "2026-08-20" })).toBeInTheDocument();
    expect(within(dataTable).getByRole("cell", { name: "2" })).toBeInTheDocument();
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
      "/workspace/northwind/settings/dashboards/home",
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

  it("sends an administrator without published tables to create the first business table", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={[]}
        overview={emptyOverview("TENANT_ADMIN")}
      />,
    );

    expect(screen.getByText("还没有业务表")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "创建第一张业务表" })[0],
    ).toHaveAttribute("href", "/workspace/northwind/settings/objects/new");
    expect(
      screen.queryByRole("link", { name: "配置工作台" }),
    ).not.toBeInTheDocument();
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

const emptyWidgetOverview = {
  ...readyOverview,
  widgets: [
    {
      id: "empty-metric",
      type: "METRIC",
      title: "空指标",
      objectCode: "orders",
      width: "QUARTER",
      sortOrder: 0,
      state: "READY",
      data: { value: null },
    },
    {
      id: "empty-distribution",
      type: "STATUS_DISTRIBUTION",
      title: "空分布",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 1,
      state: "READY",
      data: { display: "BAR", items: [] },
    },
    {
      id: "empty-trend",
      type: "TREND",
      title: "空趋势",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 2,
      state: "READY",
      data: { items: [] },
    },
    {
      id: "empty-leaderboard",
      type: "LEADERBOARD",
      title: "空排行",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 3,
      state: "READY",
      data: { items: [] },
    },
    {
      id: "empty-record-list",
      type: "RECORD_LIST",
      title: "空记录",
      objectCode: "orders",
      width: "FULL",
      sortOrder: 4,
      state: "READY",
      data: { fields: [], items: [] },
    },
  ],
} satisfies DashboardRuntimeResult;

const distributionOverview = {
  ...readyOverview,
  widgets: [
    {
      id: "funnel",
      type: "STATUS_DISTRIBUTION",
      title: "阶段漏斗",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 0,
      state: "READY",
      data: {
        display: "FUNNEL",
        items: [
          { optionKey: "open", label: "待处理", color: "BLUE", value: 8 },
          { optionKey: "done", label: "已完成", color: "GREEN", value: 4 },
        ],
      },
    },
    {
      id: "donut",
      type: "STATUS_DISTRIBUTION",
      title: "阶段环图",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 1,
      state: "READY",
      data: {
        display: "DONUT",
        items: [
          { optionKey: "unknown", label: "未知颜色", color: "BRAND_BLUE", value: 3 },
          { optionKey: "done", label: "已完成", color: "GREEN", value: 1 },
        ],
      },
    },
  ],
} satisfies DashboardRuntimeResult;

const signedDistributionOverview = {
  ...readyOverview,
  widgets: [
    {
      id: "signed-bar",
      type: "STATUS_DISTRIBUTION",
      title: "带符号条形",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 0,
      state: "READY",
      data: {
        display: "BAR",
        items: [
          { optionKey: "positive", label: "正值", color: "GREEN", value: 8 },
          { optionKey: "zero", label: "零值", color: "GRAY", value: 0 },
          { optionKey: "negative", label: "负值", color: "RED", value: -4 },
        ],
      },
    },
    {
      id: "signed-funnel",
      type: "STATUS_DISTRIBUTION",
      title: "带符号漏斗",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 1,
      state: "READY",
      data: {
        display: "FUNNEL",
        items: [
          { optionKey: "positive", label: "正向阶段", color: "GREEN", value: 8 },
          { optionKey: "zero", label: "零值阶段", color: "GRAY", value: 0 },
          { optionKey: "negative", label: "负向阶段", color: "RED", value: -4 },
        ],
      },
    },
    {
      id: "negative-donut",
      type: "STATUS_DISTRIBUTION",
      title: "含负值环图",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 2,
      state: "READY",
      data: {
        display: "DONUT",
        items: [
          { optionKey: "positive", label: "正值", color: "GREEN", value: 8 },
          { optionKey: "negative", label: "负值", color: "RED", value: -4 },
        ],
      },
    },
    {
      id: "zero-donut",
      type: "STATUS_DISTRIBUTION",
      title: "全零环图",
      objectCode: "orders",
      width: "HALF",
      sortOrder: 3,
      state: "READY",
      data: {
        display: "DONUT",
        items: [{ optionKey: "zero", label: "零值", color: "GRAY", value: 0 }],
      },
    },
  ],
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
