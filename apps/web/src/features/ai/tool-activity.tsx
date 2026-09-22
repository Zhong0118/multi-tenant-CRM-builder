"use client";

import { useEffect, useState } from "react";

import styles from "./ai-assistant.module.css";
import { toolPrimaryLine } from "./ai-copy";
import type { AiToolSummary } from "./ai-types";

export function ToolActivity({ tools }: { tools: AiToolSummary[] }) {
  const active = tools.some((tool) => tool.status === "RUNNING");
  const [open, setOpen] = useState(active);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual) return;
    setOpen(active);
  }, [active, manual]);
  if (tools.length === 0) return null;
  return (
    <div className={styles.tools}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setManual(true);
          setOpen((value) => !value);
        }}
      >
        {active ? "正在查询 CRM 数据" : "已完成的查询"}
      </button>
      {open ? (
        <ul>
          {tools.map((tool) => (
            <li key={tool.callId}>
              {toolPrimaryLine(tool)}
              <div>{tool.toolName}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
