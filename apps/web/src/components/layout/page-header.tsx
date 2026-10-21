import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

/**
 * One header for every page: an optional breadcrumb, the title with its count
 * or status, at most one line of description, and the page's actions on the
 * right. The primary action is the last one.
 */
export function PageHeader({
  title,
  description,
  status,
  count,
  breadcrumb,
  extra,
}: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderCopy}>
        {breadcrumb ? <div className={styles.pageBreadcrumb}>{breadcrumb}</div> : null}
        <div className={styles.pageTitleRow}>
          <h1>{title}</h1>
          {count !== undefined ? <span className={styles.pageCount}>{count}</span> : null}
          {status}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {extra ? <div className={styles.pageHeaderActions}>{extra}</div> : null}
    </header>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  /** A number shown beside the title, such as how many records there are. */
  count?: ReactNode;
  /** Where this page sits, such as "业务表 / 客户". */
  breadcrumb?: ReactNode;
  extra?: ReactNode;
}
