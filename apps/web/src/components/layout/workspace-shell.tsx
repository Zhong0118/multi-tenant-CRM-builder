"use client";

import { Layout, Space, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";

import styles from "./shell.module.css";

export interface WorkspaceShellProps {
  children: ReactNode;
  tenantCode: string;
}

export function WorkspaceShell({ children, tenantCode }: WorkspaceShellProps) {
  return (
    <Layout className={styles.shell}>
      <aside className={styles.sidebar}>
        <Typography.Title level={4}>工作空间</Typography.Title>
        <Typography.Text type="secondary">{tenantCode}</Typography.Text>
        <nav aria-label="工作空间导航">
          <Space direction="vertical">
            {workspaceNavigation(tenantCode).map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </Space>
        </nav>
      </aside>
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  );
}
