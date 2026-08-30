import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceHomeView } from "./workspace-home-view";

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
  it("gives employees a personal workbench with only usable objects", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="李明"
        role="EMPLOYEE"
        businessObjects={objects}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "我的工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /客户/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/customers",
    );
    expect(
      screen.queryByRole("link", { name: "配置业务对象" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("VERIFIED CONTEXT")).not.toBeInTheDocument();
  });

  it("gives company administrators direct management actions", () => {
    render(
      <WorkspaceHomeView
        tenantCode="northwind"
        tenantName="百杰"
        userName="张三"
        role="TENANT_ADMIN"
        businessObjects={objects}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "管理工作台" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /配置业务对象/ }),
    ).toHaveAttribute("href", "/workspace/northwind/settings/objects");
    expect(screen.getByRole("link", { name: /管理成员/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/members",
    );
  });
});
