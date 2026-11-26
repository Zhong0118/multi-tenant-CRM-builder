"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { FilingLinks } from "@/components/legal/filing-links";

import { AuthPreview } from "./auth-preview";
import styles from "./auth.module.css";

/**
 * Sign-in, registration and password recovery: a picture of the workspace on
 * the left, one column of form on a white sheet on the right. Below 1100px the
 * picture steps aside and the form stands alone under the brand.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  /** No longer rendered: the page title already names the step. */
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className={styles.authPage}>
      <section className={styles.showcase} aria-label="产品介绍">
        <Brand />
        <div className={styles.showcaseBody}>
          <div className={styles.showcaseCopy}>
            <p className={styles.showcaseTitle}>
              客户、商机和 AI 建议，在同一个工作台里
            </p>
            <p className={styles.showcaseText}>
              导入现有表格就能开始；AI 提出的每一处改动，都等你确认后才写入。
            </p>
          </div>
          <AuthPreview />
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.formBrand}>
          <Brand />
        </div>
        <div className={styles.formCard}>
          <h1 className={styles.formTitle}>{title}</h1>
          <p className={styles.formDescription}>{description}</p>
          {children}
          <div className={styles.formFooter}>{footer}</div>
        </div>
        <footer className={styles.filing}>
          <FilingLinks />
        </footer>
      </section>
    </main>
  );
}

function Brand() {
  return (
    <Link href="/" className={styles.authBrand}>
      <span className={styles.authMark} aria-hidden>
        百
      </span>
      百杰 CRM
    </Link>
  );
}
