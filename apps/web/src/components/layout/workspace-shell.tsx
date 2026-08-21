"use client";

import { Layout, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./shell.module.css";

export interface WorkspaceShellProps {
  children: ReactNode;
  tenantCode: string;
  tenantName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
  businessObjects: RuntimeObjectNavigation[];
}

export function WorkspaceShell({
  children,
  tenantCode,
  tenantName,
  role,
  businessObjects,
}: WorkspaceShellProps) {
  const pathname = usePathname();

  return (
    <Layout className={styles.shell} hasSider>
      <aside className={styles.sidebar}>
        <Typography.Text className={styles.shellEyebrow}>
          CURRENT WORKSPACE
        </Typography.Text>
        <Typography.Title level={4}>{tenantName}</Typography.Title>
        <Space wrap size={6}>
          <Tag>{role === "TENANT_ADMIN" ? "公司管理员" : "员工"}</Tag>
          <Typography.Text type="secondary">{tenantCode}</Typography.Text>
        </Space>

        {businessObjects.length > 0 ? (
          <nav aria-label="业务对象" className={styles.navGroup}>
            <Typography.Text className={styles.navGroupLabel}>
              业务对象
            </Typography.Text>
            <div className={styles.navList}>
              {businessObjects.map((object) => (
                <NavLink
                  key={object.code}
                  href={`/workspace/${tenantCode}/objects/${object.code}`}
                  pathname={pathname}
                >
                  {object.name}
                </NavLink>
              ))}
            </div>
          </nav>
        ) : (
          <div className={styles.navGroup}>
            <Typography.Text className={styles.navGroupLabel}>
              业务对象
            </Typography.Text>
            <Typography.Text type="secondary" className={styles.navGroupEmpty}>
              尚无已授权的业务对象
            </Typography.Text>
          </div>
        )}

        <nav aria-label="工作空间" className={styles.navGroup}>
          <Typography.Text className={styles.navGroupLabel}>
            工作空间
          </Typography.Text>
          <div className={styles.navList}>
            {workspaceNavigation(tenantCode).map((item) => (
              <NavLink key={item.href} href={item.href} pathname={pathname}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </aside>
      <Layout.Content className={styles.content}>{children}</Layout.Content>
    </Layout>
  );
}

/**
 * The workspace root would otherwise match every page below it, so only an
 * exact match counts as current there.
 */
function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string | null;
  children: ReactNode;
}) {
  const segments = href.split("/").filter(Boolean).length;
  const current =
    pathname === href ||
    (segments > 2 && (pathname ?? "").startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`${styles.navLink} ${current ? styles.navLinkCurrent : ""}`}
    >
      {children}
    </Link>
  );
}
