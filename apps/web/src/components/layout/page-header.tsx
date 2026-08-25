import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

export function PageHeader({
  title,
  description,
  extra,
}: {
  title: ReactNode;
  description?: string;
  extra?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {extra}
    </header>
  );
}
