"use client";

import { Button } from "antd";
import Link from "next/link";

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
      <section className={styles.panel}>
        <p className={styles.lead}>该能力尚未实现。</p>
        <p className={styles.hint}>
          当前切片只覆盖平台壳和公司工作空间开通。这里不会用假数据填满页面。
        </p>
        <Link href={nextHref}>
          <Button type="primary">{nextLabel}</Button>
        </Link>
      </section>
    </div>
  );
}
