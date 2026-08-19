"use client";

import { Layout, Space, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { platformNavigation } from "@/components/navigation/platform-navigation";

import styles from "./shell.module.css";

export function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <Layout className={styles.shell}>
      <aside className={styles.sidebar}>
        <Typography.Title level={4}>平台后台</Typography.Title>
        <nav aria-label="平台导航">
          <Space direction="vertical">
            {platformNavigation.map((item) => (
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
