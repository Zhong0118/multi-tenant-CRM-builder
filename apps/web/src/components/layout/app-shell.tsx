"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";
import styles from "./app-shell.module.css";

export interface ShellUser {
  displayName: string;
  phone: string;
  isPlatformAdmin: boolean;
}

export interface ShellNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export interface ShellNavGroup {
  ariaLabel: string;
  items: ShellNavItem[];
  emptyLabel?: string;
}

export interface AppShellProps {
  brand: string;
  brandHref: string;
  navGroups: ShellNavGroup[];
  headerLeft: ReactNode;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  children: ReactNode;
}

const COLLAPSED_KEY = "crm.sidebar.collapsed";
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

function getCollapsedSnapshot() {
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

function getCollapsedServerSnapshot() {
  return false;
}

export function AppShell({
  brand,
  brandHref,
  navGroups,
  headerLeft,
  user,
  roleLabel,
  showWorkspaceSwitch = false,
  children,
}: AppShellProps) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );

  const toggleCollapsed = useCallback(() => {
    window.localStorage.setItem(COLLAPSED_KEY, String(!collapsed));
    collapsedListeners.forEach((listener) => listener());
  }, [collapsed]);

  return (
    <div className={styles.shell}>
      {mobileOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <Sidebar
        brand={brand}
        brandHref={brandHref}
        navGroups={navGroups}
        pathname={pathname}
        collapsed={mobileOpen ? false : collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className={styles.column}>
        <TopHeader
          headerLeft={headerLeft}
          user={user}
          roleLabel={roleLabel}
          showWorkspaceSwitch={showWorkspaceSwitch}
          onOpenNavigation={() => setMobileOpen(true)}
        />
        <main className={styles.main} data-scroll-region="main">
          {children}
        </main>
      </div>
    </div>
  );
}
