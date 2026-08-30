import type { ReactNode } from "react";

import { ReadingPanel } from "./surface";
import styles from "./state-panel.module.css";

export function StatePanel({
  title,
  description,
  action,
  tone = "empty",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "empty" | "error" | "blocked";
}) {
  return (
    <ReadingPanel className={styles.panel} ariaLabel={title}>
      <div className={styles.content} data-tone={tone}>
        <h2>{title}</h2>
        <p>{description}</p>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </ReadingPanel>
  );
}
