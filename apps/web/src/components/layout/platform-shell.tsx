"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { platformNavigation } from "@/components/navigation/platform-navigation";

import { AppShell, type ShellUser } from "./app-shell";

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
      navGroups={[{ ariaLabel: "平台导航", items: [...platformNavigation] }]}
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
      <span>
        <Link href="/platform/tenants">公司管理</Link>
        {" / 新增公司"}
      </span>
    );
  }

  if (pathname.startsWith("/platform/tenants/") && pathname !== "/platform/tenants") {
    return (
      <span>
        <Link href="/platform/tenants">公司管理</Link>
        {" / 详情"}
      </span>
    );
  }

  const exact = SECTION_LABELS[pathname];
  if (exact) {
    return <span>{exact}</span>;
  }

  const parent = [...platformNavigation]
    .filter((item) => item.href !== "/platform" && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (parent) {
    return (
      <span>
        <Link href={parent.href}>{parent.label}</Link>
        {" / 详情"}
      </span>
    );
  }

  return <span>总览</span>;
}
