"use client";

import { useState } from "react";

import styles from "./ai-assistant.module.css";
import { toolPrimaryLine } from "./ai-copy";
import type { AiToolSummary } from "./ai-types";

export function ToolActivity({ tools }: { tools: AiToolSummary[] }) {
  const active = tools.some((tool) => tool.status === "RUNNING");
  const completedCount = tools.filter((tool) => tool.status === "COMPLETED").length;
  // Follows the running state until the user toggles it themselves.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? active;
  if (tools.length === 0) return null;
  return (
    <div className={styles.tools}>
      <button
        type="button"
        className={styles.toolToggle}
        aria-expanded={open}
        onClick={() => setManualOpen(!open)}
      >
        <span
          className={`${styles.toolDot} ${active ? styles.toolDotRunning : ""}`}
          aria-hidden
        />
        {active
          ? "正在查询 CRM 数据"
          : completedCount > 0
            ? `已查询 ${completedCount} 项 CRM 数据`
            : "已完成的查询"}
      </button>
      {open ? (
        <ul className={styles.toolList}>
          {tools.map((tool) => (
            <li key={tool.callId} className={styles.toolItem}>
              <span className={styles.toolName}>{toolPrimaryLine(tool)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
