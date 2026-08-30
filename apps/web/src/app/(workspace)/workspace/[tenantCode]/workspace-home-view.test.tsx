import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardOverview } from "@/features/dashboard/dashboard-types";

import { WorkspaceHomeView } from "./workspace-home-view";

vi.mock("@ant-design/charts", () => ({
  Bar: () => <div data-testid="pipeline-chart" />,
  DualAxes: () => <div data-testid="trend-chart" />,
}));

const objects = [
  {
    code: "customers",
    name: "客户",
    icon: null,
    sortOrder: 10,
    canCreate: true,
    canRead: true,
    canUpdate: true,
  },
];

describe("WorkspaceHomeView", () => {
  it("gives employees a personal execution workbench without team ranking", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="李明"
        role="EMPLOYEE"
        businessObjects={objects}
        overview={{ ...readyOverview, role: "EMPLOYEE", leaderboard: [] }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "我的工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("我的销售管道")).toBeInTheDocument();
    expect(screen.getByText("优先跟进")).toBeInTheDocument();
    expect(screen.queryByText("员工业绩排行")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /客户/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/customers",
    );
  });

  it("gives company administrators team results and attention modules", () => {
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

    expect(
      screen.getByRole("heading", { name: "管理工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("销售管道")).toBeInTheDocument();
    expect(screen.getByText("需要处理")).toBeInTheDocument();
    expect(screen.getByText("员工业绩排行")).toBeInTheDocument();
    expect(screen.getAllByText("王芳").length).toBeGreaterThan(0);
  });

  it("guides only administrators to configure an unconfigured dashboard", () => {
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

    expect(screen.getByRole("link", { name: /配置工作台/ })).toHaveAttribute(
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
    expect(screen.getByText("公司尚未启用工作台")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /配置工作台/ }),
    ).not.toBeInTheDocument();
  });
});

const readyOverview = {
  state: "READY",
  role: "TENANT_ADMIN",
  period: {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-31T00:00:00.000Z",
    timezone: "Asia/Shanghai",
  },
  configuration: {
    opportunity: {
      objectCode: "opportunities",
      stageFieldKey: "stage",
      activeOptionKeys: ["new"],
      wonOptionKeys: ["won"],
      lostOptionKeys: ["lost"],
    },
  },
  issues: [],
  metrics: [
    { key: "active", label: "进行中商机", value: 12, format: "COUNT" },
    {
      key: "wonAmount",
      label: "成交金额",
      value: 168000,
      format: "MONEY",
    },
  ],
  pipeline: [
    {
      optionKey: "new",
      label: "新商机",
      color: "BLUE",
      count: 8,
      amount: 86000,
    },
    {
      optionKey: "won",
      label: "已成交",
      color: "GREEN",
      count: 4,
      amount: 168000,
    },
  ],
  trend: [{ date: "2026-08-20", wonCount: 2, wonAmount: 68000 }],
  attention: [
    {
      key: "stale",
      label: "超过 7 天未更新",
      count: 3,
      href: "/workspace/northwind/objects/opportunities",
    },
  ],
  leaderboard: [
    {
      memberId: "member-1",
      displayName: "王芳",
      wonCount: 3,
      wonAmount: 98000,
      activeAmount: 46000,
    },
  ],
  records: [
    {
      id: "record-1",
      title: "东海集团年度合作",
      ownerMemberId: "member-1",
      ownerName: "王芳",
      stageKey: "new",
      amount: 42000,
      dueAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ],
} satisfies DashboardOverview;

function emptyOverview(role: DashboardOverview["role"]): DashboardOverview {
  return {
    state: "UNCONFIGURED",
    role,
    period: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T00:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
    issues: [],
    metrics: [],
    pipeline: [],
    trend: [],
    attention: [],
    leaderboard: [],
    records: [],
  };
}
