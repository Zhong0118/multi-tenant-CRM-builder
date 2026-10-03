import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  });

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

  it("defaults to compact navigation at 900 without writing a desktop preference", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    renderShell();
    expect(screen.getByRole("navigation", { name: "平台导航" }))
      .toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBeNull();
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("navigation", { name: "平台导航" }))
      .not.toHaveAttribute("data-collapsed");
  });

  it("honors an explicit expanded preference at 900 and preserves width across resize", () => {
    window.localStorage.setItem("crm.sidebar.collapsed", "false");
    window.localStorage.setItem("crm.sidebar.width", "280");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    renderShell();
    expect(screen.getByRole("navigation", { name: "平台导航" })).not.toHaveAttribute("data-collapsed");
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("complementary")).toHaveStyle({ "--sidebar-width": "280px" });
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBe("false");
  });

  it("lets a user manually expand the default compact navigation", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "展开菜单" }));
    expect(screen.getByRole("navigation", { name: "平台导航" })).not.toHaveAttribute("data-collapsed");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBe("false");
  });

  it.each(["escape", "close", "link"])("restores mobile trigger focus after %s", (method) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderShell();
    const trigger = screen.getByRole("button", { name: "打开导航" });
    trigger.focus();
    fireEvent.click(trigger);
    const link = screen.getByRole("link", { name: "公司管理" });
    link.focus();
    if (method === "escape") fireEvent.keyDown(link, { key: "Escape" });
    else if (method === "close") fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
    else {
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(link);
    }
    expect(screen.getByRole("complementary")).not.toHaveAttribute("data-mobile-open");
    expect(trigger).toHaveFocus();
  });

  it("contains mobile Tab and Shift+Tab focus and makes background inert", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    const first = screen.getByRole("link", { name: "平台后台" });
    const last = screen.getByRole("button", { name: "退出登录" });
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    expect(screen.getByRole("main").parentElement).toHaveAttribute("inert");
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.getByRole("main").parentElement).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
  });

  it("clears mobile navigation on resize without focusing the hidden trigger or changing preferences", () => {
    window.localStorage.setItem("crm.sidebar.collapsed", "true");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("complementary")).not.toHaveAttribute("data-mobile-open");
    expect(screen.getByRole("main").parentElement).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "打开导航" })).not.toHaveFocus();
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBe("true");
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByRole("button", { name: "关闭导航" })).not.toBeInTheDocument();
  });

  it("mobile collapse closes navigation without changing the desktop preference", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    fireEvent.click(screen.getByRole("button", { name: "收起菜单" }));
    expect(screen.getByRole("complementary")).not.toHaveAttribute("data-mobile-open");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBeNull();
    expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
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

  it("lets a desktop user drag the sidebar and remembers the expanded width", () => {
    renderShell();
    const handle = screen.getByRole("separator", { name: "调整侧栏宽度" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 224 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 280 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 280 });

    expect(screen.getByRole("complementary")).toHaveStyle({
      "--sidebar-width": "280px",
    });
    expect(window.localStorage.getItem("crm.sidebar.width")).toBe("280");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).not.toBe(
      "true",
    );
  });

  it("collapses when dragged past the icon-rail threshold and keeps the previous width", () => {
    window.localStorage.setItem("crm.sidebar.width", "280");
    renderShell();
    const handle = screen.getByRole("separator", { name: "调整侧栏宽度" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 280 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });

    expect(
      screen.getByRole("navigation", { name: "平台导航" }),
    ).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).toBe("true");
    expect(window.localStorage.getItem("crm.sidebar.width")).toBe("280");
  });

  it("restores the default expanded width on double-click", () => {
    window.localStorage.setItem("crm.sidebar.width", "300");
    renderShell();
    const handle = screen.getByRole("separator", { name: "调整侧栏宽度" });

    fireEvent.doubleClick(handle);

    expect(screen.getByRole("complementary")).toHaveStyle({
      "--sidebar-width": "224px",
    });
    expect(window.localStorage.getItem("crm.sidebar.width")).toBe("224");
    expect(window.localStorage.getItem("crm.sidebar.collapsed")).not.toBe(
      "true",
    );
  });
});
