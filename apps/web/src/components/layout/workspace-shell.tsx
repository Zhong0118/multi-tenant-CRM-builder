"use client";

import { Layout, Space, Tag, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { workspaceNavigation } from "@/components/navigation/workspace-navigation";

import styles from "./shell.module.css";

export interface WorkspaceShellProps {
  children: ReactNode;
  tenantCode: string;
  tenantName: string;
  role: "TENANT_ADMIN" | "EMPLOYEE";
}

export function WorkspaceShell({
  children,
  tenantCode,
  tenantName,
  role,
}: WorkspaceShellProps) {
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
        <nav aria-label="工作空间导航">
          <Space orientation="vertical">
            {workspaceNavigation(tenantCode).map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </Space>
        </nav>
      </aside>
      <Layout.Content className={styles.content}>{children}</Layout.Content>
    </Layout>
  );
}
