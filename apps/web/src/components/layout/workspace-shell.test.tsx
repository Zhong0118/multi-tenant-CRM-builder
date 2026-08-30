import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";

import { WorkspaceShell } from "./workspace-shell";

const mocks = vi.hoisted(() => ({
  pathname: "/workspace/northwind",
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

const shellUser = {
  displayName: "张三",
  phone: "+8613900000001",
  isPlatformAdmin: false,
};

beforeEach(() => {
  mocks.pathname = "/workspace/northwind";
});

function businessObject(overrides: Record<string, unknown> = {}) {
  return {
    code: "customers",
    name: "客户资料",
    icon: null,
    sortOrder: 10,
    canCreate: true,
    canRead: true,
    canUpdate: true,
    ...overrides,
  };
}

describe("workspaceNavigation", () => {
  it("keeps management destinations for company administrators", () => {
    const items = workspaceNavigation("northwind", "TENANT_ADMIN");

    expect(items.map((item) => item.href)).toEqual([
      "/workspace/northwind",
      "/workspace/northwind/members",
      "/workspace/northwind/settings",
    ]);
    expect(items.some((item) => item.href.includes("/objects/"))).toBe(false);
  });

  it("keeps employees on their home and authorized business objects", () => {
    expect(workspaceNavigation("northwind", "EMPLOYEE")).toEqual([
      {
        href: "/workspace/northwind",
        label: "我的工作台",
        icon: "home",
      },
    ]);
  });
});

describe("WorkspaceShell", () => {
  it("keeps employee navigation free of administrator destinations", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
        user={shellUser}
        businessObjects={[
          businessObject(),
          businessObject({ code: "leads", name: "获客", sortOrder: 20 }),
        ]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    const business = screen.getByRole("navigation", { name: "业务对象" });
    const system = screen.getByRole("navigation", { name: "工作空间" });

    expect(
      within(business).getByRole("link", { name: "客户资料" }),
    ).toHaveAttribute("href", "/workspace/northwind/objects/customers");
    expect(
      within(business).getByRole("link", { name: "获客" }),
    ).toHaveAttribute("href", "/workspace/northwind/objects/leads");
    expect(
      within(system).getByRole("link", { name: "我的工作台" }),
    ).toHaveAttribute("href", "/workspace/northwind");
    expect(
      within(system).queryByRole("link", { name: "成员管理" }),
    ).not.toBeInTheDocument();
    expect(
      within(system).queryByRole("link", { name: "设置" }),
    ).not.toBeInTheDocument();
    expect(
      within(business).queryByRole("link", { name: "成员管理" }),
    ).not.toBeInTheDocument();
  });

  it("shows management destinations to company administrators", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="TENANT_ADMIN"
        user={shellUser}
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    const system = screen.getByRole("navigation", { name: "工作空间" });
    expect(
      within(system).getByRole("link", { name: "成员管理" }),
    ).toHaveAttribute("href", "/workspace/northwind/members");
    expect(within(system).getByRole("link", { name: "设置" })).toHaveAttribute(
      "href",
      "/workspace/northwind/settings",
    );
  });

  it("highlights only the most specific workspace destination", () => {
    mocks.pathname = "/workspace/northwind/settings/objects";
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="TENANT_ADMIN"
        user={shellUser}
        businessObjects={[]}
      >
        <p>设置内容</p>
      </WorkspaceShell>,
    );

    const system = screen.getByRole("navigation", { name: "工作空间" });
    expect(within(system).getByRole("link", { name: "设置" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(system).getByRole("link", { name: "管理工作台" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("renders business object links in the order supplied by the server", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
        user={shellUser}
        businessObjects={[
          businessObject({ code: "leads", name: "获客" }),
          businessObject({ code: "customers", name: "客户资料" }),
        ]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    const links = within(
      screen.getByRole("navigation", { name: "业务对象" }),
    ).getAllByRole("link");

    expect(links.map((link) => link.textContent?.replace(/\s+/g, ""))).toEqual([
      "获客",
      "客户资料",
    ]);
  });

  it("explains an empty business navigation instead of rendering a bare group", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
        user={shellUser}
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    expect(
      screen.queryByRole("navigation", { name: "业务对象" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("尚无已授权的业务对象")).toBeInTheDocument();
  });

  it("keeps the workspace identity and role visible", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="TENANT_ADMIN"
        user={shellUser}
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    expect(screen.getAllByText("百杰").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /张三/ })).toBeInTheDocument();
    expect(screen.queryByText("northwind")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /张三/ }));
    expect(screen.getByRole("link", { name: "切换工作空间" })).toHaveAttribute(
      "href",
      "/workspaces",
    );
  });

  it("labels an employee in the user menu", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
        user={shellUser}
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    expect(screen.getByRole("button", { name: /张三/ })).toBeInTheDocument();
    expect(screen.getByText("员工")).toBeInTheDocument();
  });

  it("uses the same independent navigation and content scroll contract", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
        user={shellUser}
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    expect(screen.getByTestId("sidebar-navigation-scroll")).toHaveAttribute(
      "data-scroll-region",
      "navigation",
    );
    expect(screen.getByRole("main")).toHaveAttribute(
      "data-scroll-region",
      "main",
    );
  });
});
