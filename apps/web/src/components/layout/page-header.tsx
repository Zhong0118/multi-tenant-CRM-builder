import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

export function PageHeader({
  title,
  description,
  status,
  extra,
}: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderCopy}>
        <div className={styles.pageTitleRow}>
          <h1>{title}</h1>
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
  extra?: ReactNode;
}
