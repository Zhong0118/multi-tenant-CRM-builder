"use client";

import { SafetyCertificateOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type { ReactNode } from "react";

import styles from "./auth.module.css";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className={styles.authPage}>
      <section className={styles.statement} aria-label="产品说明">
        <div className={styles.brandMark}>CRM / WORKSPACE</div>
        <div className={styles.statementBody}>
          <span className={styles.trackDot} aria-hidden="true" />
          <Typography.Title level={1}>
            把分散的 Excel <br />
            变成可协作的业务流程
          </Typography.Title>
          <Typography.Paragraph>
            从个人账号进入受授权的公司工作区。数据、权限和操作记录始终归属于正确的公司。
          </Typography.Paragraph>
        </div>
        <div className={styles.trustLine}>
          <SafetyCertificateOutlined aria-hidden="true" />
          手机验证 · 独立账号 · 公司级权限隔离
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.formCard}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <Typography.Title level={2}>{title}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {description}
          </Typography.Paragraph>
          {children}
          <div className={styles.formFooter}>{footer}</div>
        </div>
      </section>
    </main>
  );
}
