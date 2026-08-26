"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NavIcon } from "@/components/navigation/nav-icon";
import { platformNavigation } from "@/components/navigation/platform-navigation";

import { AppShell, type ShellUser } from "./app-shell";
import styles from "./app-shell.module.css";

export function PlatformShell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  const pathname = usePathname() ?? "";
  return (
    <AppShell
      brand="平台后台"
      brandHref="/platform"
      navGroups={[
        {
          ariaLabel: "平台导航",
          items: platformNavigation.map((item) => ({
            href: item.href,
            label: item.label,
            icon: <NavIcon name={item.icon} />,
          })),
        },
      ]}
      headerLeft={<PlatformBreadcrumb pathname={pathname} />}
      user={user}
      roleLabel="平台超级管理员"
    >
      {children}
    </AppShell>
  );
}

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  platformNavigation.map((item) => [item.href, item.label]),
);

export function PlatformBreadcrumb({ pathname }: { pathname: string }) {
  if (pathname === "/platform/tenants/new") {
    return (
      <span className={styles.breadcrumb}>
        <Link href="/platform/tenants">公司管理</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>新增公司</span>
      </span>
    );
  }

  if (
    pathname.startsWith("/platform/tenants/") &&
    pathname !== "/platform/tenants"
  ) {
    return (
      <span className={styles.breadcrumb}>
        <Link href="/platform/tenants">公司管理</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>详情</span>
      </span>
    );
  }

  if (pathname === "/platform/templates/new") {
    return (
      <span className={styles.breadcrumb}>
        <Link href="/platform/templates">模板</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>新建模板</span>
      </span>
    );
  }

  const exact = SECTION_LABELS[pathname];
  if (exact) {
    return <span className={styles.breadcrumbCurrent}>{exact}</span>;
  }

  const parent = [...platformNavigation]
    .filter(
      (item) =>
        item.href !== "/platform" && pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (parent) {
    return (
      <span className={styles.breadcrumb}>
        <Link href={parent.href}>{parent.label}</Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>详情</span>
      </span>
    );
  }

  return <span className={styles.breadcrumbCurrent}>总览</span>;
}
