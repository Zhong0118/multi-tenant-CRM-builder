"use client";

import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import Link from "next/link";

import { LogoutButton } from "@/features/auth/logout-button";

import styles from "./app-shell.module.css";
import type { ShellNavGroup } from "./app-shell";

export function isNavItemCurrent(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/platform") return false;
  const segments = href.split("/").filter(Boolean);
  return segments.length > 1 && pathname.startsWith(`${href}/`);
}

export function Sidebar({
  brand,
  brandHref,
  navGroups,
  pathname,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  brand: string;
  brandHref: string;
  navGroups: ShellNavGroup[];
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const toggleLabel = collapsed ? "展开菜单" : "收起菜单";
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
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}
      data-mobile-open={mobileOpen ? "true" : undefined}
    >
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
              <p key={group.ariaLabel} className={styles.emptyLabel}>
                {group.emptyLabel}
              </p>
            ) : null
          ) : (
            <nav
              key={group.ariaLabel}
              aria-label={group.ariaLabel}
              className={styles.nav}
              data-collapsed={collapsed ? "true" : undefined}
            >
              {group.items.map((item) => {
                const current = isNavItemCurrent(pathname, item.href);
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
