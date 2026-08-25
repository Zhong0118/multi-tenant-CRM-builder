"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        brand={brand}
        brandHref={brandHref}
        navGroups={navGroups}
        pathname={pathname}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      <div className={styles.column}>
        <TopHeader
          headerLeft={headerLeft}
          user={user}
          roleLabel={roleLabel}
          showWorkspaceSwitch={showWorkspaceSwitch}
        />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
