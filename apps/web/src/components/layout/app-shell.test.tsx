import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { platformNavigation } from "@/components/navigation/platform-navigation";

import { AppShell } from "./app-shell";

const mocks = vi.hoisted(() => ({
  pathname: "/platform/tenants",
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

function renderShell() {
  return render(
    <AppShell
      brand="平台后台"
      brandHref="/platform"
      navGroups={[
        {
          ariaLabel: "平台导航",
          items: platformNavigation.map((item) => ({
            href: item.href,
            label: item.label,
          })),
        },
      ]}
      headerLeft={<span>公司管理</span>}
      user={{
        displayName: "王明",
        phone: "+8613800138000",
        isPlatformAdmin: true,
      }}
      roleLabel="平台超级管理员"
    >
      <p>内容</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("renders company-management navigation and the platform user menu", () => {
    mocks.pathname = "/platform/tenants";
    renderShell();

    expect(screen.getByRole("link", { name: "公司管理" })).toHaveAttribute(
      "href",
      "/platform/tenants",
    );
    expect(
      screen.queryByRole("link", { name: "租户" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /王明/ }));
    expect(screen.getByText("138****8000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "账号与安全" })).toHaveAttribute(
      "href",
      "/account/security",
    );
    expect(
      screen.queryByRole("menuitem", { name: "切换工作空间" }),
    ).not.toBeInTheDocument();
  });

  it("marks the current platform section and can collapse to icons", () => {
    mocks.pathname = "/platform/tenants/abc";
    renderShell();
    expect(screen.getByRole("link", { name: "公司管理" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "收起菜单" }));
    expect(
      screen.getByRole("navigation", { name: "平台导航" }),
    ).toHaveAttribute("data-collapsed", "true");
  });

  it("renders emptyLabel without a named navigation group", () => {
    render(
      <AppShell
        brand="百杰"
        brandHref="/workspace/northwind"
        navGroups={[
          {
            ariaLabel: "业务对象",
            items: [],
            emptyLabel: "尚无已授权的业务对象",
          },
        ]}
        headerLeft={<span>百杰</span>}
        user={{
          displayName: "张三",
          phone: "+8613900000001",
          isPlatformAdmin: false,
        }}
        roleLabel="公司管理员"
      >
        <p>内容</p>
      </AppShell>,
    );

    expect(
      screen.queryByRole("navigation", { name: "业务对象" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("尚无已授权的业务对象")).toBeInTheDocument();
  });

  it("opens and closes the temporary navigation on compact screens", () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    expect(screen.getByRole("complementary")).toHaveAttribute(
      "data-mobile-open",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
    expect(screen.getByRole("complementary")).not.toHaveAttribute(
      "data-mobile-open",
      "true",
    );
  });

  it("keeps navigation and work content in separate scroll regions", () => {
    renderShell();

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
