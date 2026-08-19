"use client";

import { Alert, Typography } from "antd";

import styles from "./page-placeholder.module.css";

export interface PagePlaceholderProps {
  description: string;
  title: string;
}

export function PagePlaceholder({ description, title }: PagePlaceholderProps) {
  return (
    <main className={styles.page}>
      <Typography.Title level={1}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {description}
      </Typography.Paragraph>
      <Alert
        message="页面骨架已建立，业务功能尚未实现。"
        type="info"
        showIcon
      />
    </main>
  );
}
