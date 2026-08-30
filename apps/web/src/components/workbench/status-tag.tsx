import type { ReactNode } from "react";

import styles from "./status-tag.module.css";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export function StatusTag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span className={styles.tag} data-tone={tone}>
      {children}
    </span>
  );
}
