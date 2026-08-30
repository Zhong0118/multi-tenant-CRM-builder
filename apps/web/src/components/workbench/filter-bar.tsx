import type { ReactNode } from "react";

import styles from "./filter-bar.module.css";

export function FilterBar({
  children,
  search,
  batchActions,
  ariaLabel = "筛选与批量操作",
}: {
  children: ReactNode;
  search?: ReactNode;
  batchActions?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className={styles.bar} role="toolbar" aria-label={ariaLabel}>
      {search ? <div className={styles.search}>{search}</div> : null}
      <div className={styles.filters}>{children}</div>
      {batchActions ? (
        <div className={styles.batchActions}>{batchActions}</div>
      ) : null}
    </div>
  );
}
