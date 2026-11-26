import type { ReactNode } from "react";

import { AiSparkIcon } from "@/components/icons/ai-spark-icon";

import styles from "./ai-badge.module.css";

/**
 * The one mark for "AI wrote this": a small violet label in front of AI
 * drafts, suggestions, reasons and proposals. Status (待确认 / 已执行) is a
 * separate tag; this badge only says who wrote the content.
 */
export function AiBadge({ children = "AI 生成" }: { children?: ReactNode }) {
  return (
    <span className={styles.badge}>
      <AiSparkIcon aria-hidden />
      {children}
    </span>
  );
}
