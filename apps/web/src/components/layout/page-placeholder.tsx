"use client";

import { Alert } from "antd";

import { PageHeader } from "./page-header";
import styles from "./page-placeholder.module.css";

export interface PagePlaceholderProps {
  description: string;
  title: string;
}

export function PagePlaceholder({ description, title }: PagePlaceholderProps) {
  return (
    <div className={styles.page}>
      <PageHeader title={title} description={description} />
      <Alert title="该能力尚未实现。" type="info" showIcon />
    </div>
  );
}
