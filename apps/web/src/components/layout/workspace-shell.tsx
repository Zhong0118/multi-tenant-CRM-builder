"use client";

import { Layout, Space, Tag, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";
import { workspaceNavigation } from "@/components/navigation/workspace-navigation";

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
            <Space orientation="vertical">
              {businessObjects.map((object) => (
                <Link
                  key={object.code}
                  href={`/workspace/${tenantCode}/objects/${object.code}`}
                >
                  {object.name}
                </Link>
              ))}
            </Space>
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
