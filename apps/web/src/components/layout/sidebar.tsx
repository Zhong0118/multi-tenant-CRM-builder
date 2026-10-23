"use client";

import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import Link from "next/link";
import type { PointerEvent, ReactNode } from "react";

import styles from "./app-shell.module.css";
import type { ShellNavGroup, ShellNavItem, ShellUser } from "./app-shell";
import { UserMenu } from "./user-menu";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./sidebar-width";

export function isNavItemCurrent(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/platform") return false;
  const segments = href.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "workspace") return false;
  return segments.length > 1 && pathname.startsWith(`${href}/`);
}

export function currentNavHref(
  pathname: string,
  groups: ShellNavGroup[],
): string | undefined {
  return groups
    .flatMap((group) => group.items)
    .filter((item) => item.href && isNavItemCurrent(pathname, item.href))
    .sort((left, right) => (right.href?.length ?? 0) - (left.href?.length ?? 0))[0]?.href;
}

/** What a custom nav item (such as the message inbox) needs to look like a link. */
export interface NavItemRenderState {
  collapsed: boolean;
  className: string;
  iconClassName: string;
  labelClassName: string;
  countClassName: string;
  /** Left edge for a panel that slides out beside the sidebar. */
  panelOffset: number;
  /** Closes the phone navigation drawer before a panel opens. */
  onNavigate: () => void;
}

export function Sidebar({
  brand,
  brandIcon,
  brandHref,
  user,
  roleLabel,
  showWorkspaceSwitch,
  navGroups,
  footerItems = [],
  pathname,
  collapsed,
  width,
  resizing = false,
  onToggle,
  mobileOpen,
  onMobileClose,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizeDoubleClick,
}: {
  brand: string;
  brandIcon?: ReactNode;
  brandHref: string;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  navGroups: ShellNavGroup[];
  /** Destinations pinned above the account, such as settings. */
  footerItems?: ShellNavItem[];
  pathname: string;
  collapsed: boolean;
  width: number;
  resizing?: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onResizePointerMove: (event: PointerEvent<HTMLElement>) => void;
  onResizePointerUp: (event: PointerEvent<HTMLElement>) => void;
  onResizeDoubleClick: () => void;
}) {
  const toggleLabel = collapsed ? "展开菜单" : "收起菜单";
  const activeHref = currentNavHref(pathname, [...navGroups, { ariaLabel: "", items: footerItems }]);
  const renderState: NavItemRenderState = {
    collapsed,
    className: styles.navItem,
    iconClassName: styles.navIcon,
    labelClassName: styles.navLabel,
    countClassName: styles.navCount,
    panelOffset: mobileOpen ? 0 : collapsed ? SIDEBAR_COLLAPSED_WIDTH : width,
    onNavigate: onMobileClose,
  };

  const toggleButton = (
    <button
      type="button"
      className={styles.toggle}
      onClick={mobileOpen ? onMobileClose : onToggle}
      aria-label={toggleLabel}
    >
      {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
    </button>
  );

  function navItem(item: ShellNavItem) {
    if (item.render) {
      return <div key={item.key ?? item.label}>{item.render(renderState)}</div>;
    }
    const href = item.href ?? "";
    const current = href === activeHref;
    const link = (
      <Link
        href={href}
        onClick={onMobileClose}
        aria-current={current ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={`${styles.navItem} ${current ? styles.navItemCurrent : ""} ${item.subtle ? styles.navItemSubtle : ""}`}
      >
        {item.icon ? (
          <span className={styles.navIcon} aria-hidden>
            {item.icon}
          </span>
        ) : null}
        {collapsed ? null : <span className={styles.navLabel}>{item.label}</span>}
        {!collapsed && item.count !== undefined ? (
          <span className={styles.navCount}>{item.count}</span>
        ) : null}
      </Link>
    );

    return collapsed ? (
      <Tooltip key={href} title={item.label} placement="right">
        {link}
      </Tooltip>
    ) : (
      <div key={href}>{link}</div>
    );
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""} ${resizing ? styles.sidebarResizing : ""}`}
      style={{ ["--sidebar-width" as string]: `${width}px` }}
      data-mobile-open={mobileOpen ? "true" : undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}
        className={styles.resizeHandle}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={onResizeDoubleClick}
      />
      <div className={styles.brandRow}>
        <Link href={brandHref} className={styles.brand} aria-label={brand} onClick={onMobileClose}>
          <span className={styles.brandMark} aria-hidden>
            {brandIcon ?? brand.slice(0, 1)}
          </span>
          {collapsed ? null : <span className={styles.brandName}>{brand}</span>}
        </Link>
        {collapsed ? (
          <Tooltip title={toggleLabel} placement="right">
            {toggleButton}
          </Tooltip>
        ) : (
          toggleButton
        )}
      </div>
      <div
        className={styles.navScroll}
        data-testid="sidebar-navigation-scroll"
        data-scroll-region="navigation"
      >
        {navGroups.map((group, index) =>
          group.items.length === 0 ? (
            group.emptyLabel ? (
              <div key={group.ariaLabel} className={styles.emptyNav}>
                <p className={styles.emptyLabel}>{group.emptyLabel}</p>
                {group.emptyHref && group.emptyActionLabel && !collapsed ? (
                  <Link
                    href={group.emptyHref}
                    className={styles.emptyAction}
                    onClick={onMobileClose}
                  >
                    {group.emptyActionLabel}
                  </Link>
                ) : null}
              </div>
            ) : null
          ) : (
            <nav
              key={group.ariaLabel || index}
              aria-label={group.ariaLabel}
              className={styles.nav}
              data-collapsed={collapsed ? "true" : undefined}
            >
              {collapsed || group.hideLabel ? null : (
                <div className={styles.navGroupLabel}>{group.ariaLabel}</div>
              )}
              {group.items.map(navItem)}
            </nav>
          ),
        )}
      </div>
      <div className={styles.bottom}>
        {footerItems.length ? (
          <nav aria-label="设置" className={styles.footerNav}>
            {footerItems.map(navItem)}
          </nav>
        ) : null}
        <UserMenu
          user={user}
          roleLabel={roleLabel}
          showWorkspaceSwitch={showWorkspaceSwitch}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
