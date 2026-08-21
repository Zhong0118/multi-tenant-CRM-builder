import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";

import { WorkspaceShell } from "./workspace-shell";

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
  it("keeps only system destinations and excludes business object routes", () => {
    const items = workspaceNavigation("northwind");

    expect(items.map((item) => item.href)).toEqual([
      "/workspace/northwind",
      "/workspace/northwind/statistics",
      "/workspace/northwind/members",
      "/workspace/northwind/import-export",
      "/workspace/northwind/audit",
      "/workspace/northwind/settings",
    ]);
    expect(items.some((item) => item.href.includes("/objects/"))).toBe(false);
  });
});

describe("WorkspaceShell", () => {
  it("groups business objects apart from workspace destinations", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
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
      within(system).getByRole("link", { name: "成员管理" }),
    ).toHaveAttribute("href", "/workspace/northwind/members");
    expect(
      within(business).queryByRole("link", { name: "成员管理" }),
    ).not.toBeInTheDocument();
  });

  it("renders business object links in the order supplied by the server", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
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

    expect(links.map((link) => link.textContent)).toEqual(["获客", "客户资料"]);
  });

  it("explains an empty business navigation instead of rendering a bare group", () => {
    render(
      <WorkspaceShell
        tenantCode="northwind"
        tenantName="百杰"
        role="EMPLOYEE"
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
        businessObjects={[]}
      >
        <p>内容</p>
      </WorkspaceShell>,
    );

    expect(screen.getByText("百杰")).toBeInTheDocument();
    expect(screen.getByText("公司管理员")).toBeInTheDocument();
    expect(screen.getByText("northwind")).toBeInTheDocument();
  });
});
