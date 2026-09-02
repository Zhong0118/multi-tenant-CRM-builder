"use client";

import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import Link from "next/link";
import type { PointerEvent } from "react";

import { LogoutButton } from "@/features/auth/logout-button";

import styles from "./app-shell.module.css";
import type { ShellNavGroup } from "./app-shell";
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
    .filter((item) => isNavItemCurrent(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

export function Sidebar({
  brand,
  brandHref,
  navGroups,
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
  brandHref: string;
  navGroups: ShellNavGroup[];
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
  const activeHref = currentNavHref(pathname, navGroups);
  const toggleButton = (
    <button
      type="button"
      className={styles.toggle}
      onClick={onToggle}
      aria-label={toggleLabel}
    >
      {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      {collapsed ? null : <span className={styles.navLabel}>收起菜单</span>}
    </button>
  );

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
      <Link href={brandHref} className={styles.brand} onClick={onMobileClose}>
        <span className={styles.brandMark} aria-hidden>
          {brand.slice(0, 1)}
        </span>
        {collapsed ? null : <span className={styles.brandName}>{brand}</span>}
      </Link>
      <div
        className={styles.navScroll}
        data-testid="sidebar-navigation-scroll"
        data-scroll-region="navigation"
      >
        {navGroups.map((group) =>
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
              key={group.ariaLabel}
              aria-label={group.ariaLabel}
              className={styles.nav}
              data-collapsed={collapsed ? "true" : undefined}
            >
              {group.items.map((item) => {
                const current = item.href === activeHref;
                const icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onMobileClose}
                    aria-current={current ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={`${styles.navItem} ${current ? styles.navItemCurrent : ""}`}
                  >
                    {icon ? (
                      <span className={styles.navIcon} aria-hidden>
                        {icon}
                      </span>
                    ) : null}
                    {collapsed ? null : (
                      <span className={styles.navLabel}>{item.label}</span>
                    )}
                  </Link>
                );

                return collapsed ? (
                  <Tooltip key={item.href} title={item.label} placement="right">
                    {link}
                  </Tooltip>
                ) : (
                  <div key={item.href}>{link}</div>
                );
              })}
            </nav>
          ),
        )}
      </div>
      <div className={styles.bottom}>
        {collapsed ? (
          <Tooltip title={toggleLabel} placement="right">
            {toggleButton}
          </Tooltip>
        ) : (
          toggleButton
        )}
        <div className={styles.logout}>
          {collapsed ? (
            <Tooltip title="退出登录" placement="right">
              <span>
                <LogoutButton iconOnly />
              </span>
            </Tooltip>
          ) : (
            <LogoutButton />
          )}
        </div>
      </div>
    </aside>
  );
}
