"use client";

import { Button } from "antd";
import Link from "next/link";

import { StatePanel } from "@/components/workbench/state-panel";

import { PageHeader } from "./page-header";
import styles from "./page-placeholder.module.css";

export interface PagePlaceholderProps {
  description: string;
  title: string;
  nextHref?: string;
  nextLabel?: string;
}

export function PagePlaceholder({
  description,
  title,
  nextHref = "/platform",
  nextLabel = "返回总览",
}: PagePlaceholderProps) {
  return (
    <div className={styles.page}>
      <PageHeader title={title} description={description} />
      <StatePanel
        title="该能力尚未实现。"
        description="当前切片只覆盖平台壳和公司工作空间开通。这里不会用假数据填满页面。"
        tone="blocked"
        action={
          <Link href={nextHref}>
            <Button type="primary">{nextLabel}</Button>
          </Link>
        }
      />
    </div>
  );
}
