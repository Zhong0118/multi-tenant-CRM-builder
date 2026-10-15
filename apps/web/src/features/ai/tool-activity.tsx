"use client";

import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, RightOutlined, StopOutlined } from "@ant-design/icons";
import { useId, useState } from "react";

import styles from "./ai-assistant.module.css";
import { elapsedSince, formatDuration } from "./ai-elapsed";
import type { AiToolSummary } from "./ai-types";

export function ToolActivity({ tools, running = true, now }: { tools: AiToolSummary[]; running?: boolean; now?: number }) {
  const active = running && tools.some((tool) => tool.status === "RUNNING");
  const completedCount = tools.filter((tool) => tool.status === "COMPLETED").length;
  const failedCount = tools.filter((tool) => tool.status === "FAILED").length;
  const interruptedCount = running ? 0 : tools.filter((tool) => tool.status === "RUNNING").length;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? active;
  const id = useId();
  if (tools.length === 0) return null;
  const summary = [completedCount ? `${completedCount} 项成功` : "", failedCount ? `${failedCount} 项失败` : "", interruptedCount ? `${interruptedCount} 项已中断` : ""].filter(Boolean).join("，");
  return (
    <div className={styles.tools}>
      <button type="button" className={styles.toolToggle} aria-expanded={open} aria-controls={id} onClick={() => setManualOpen(!open)}>
        <span aria-hidden className={failedCount ? styles.toolFailed : styles.toolStatus}>
          {active ? <LoadingOutlined spin /> : failedCount ? <CloseCircleOutlined /> : interruptedCount ? <StopOutlined /> : <CheckCircleOutlined />}
        </span>
        <span>{active ? `正在查询 CRM 数据${summary ? `，${summary}` : ""}` : failedCount || interruptedCount ? summary : `已查询 ${completedCount} 项 CRM 数据`}</span>
        <RightOutlined aria-hidden className={`${styles.toolChevron} ${open ? styles.toolChevronOpen : ""}`} />
      </button>
      <div id={id} className={`${styles.toolReveal} ${open ? styles.toolRevealOpen : ""}`} inert={!open} aria-hidden={!open}>
        <div>
          <ul className={styles.toolList}>
            {tools.map((tool) => {
              const pending = tool.status === "RUNNING";
              const status = pending ? running ? "进行中" : "已中断" : tool.status === "FAILED" ? "失败" : "成功";
              const duration = tool.durationMs ?? (pending && now !== undefined ? elapsedSince(tool.startedAt, now) : undefined);
              return (
                <li key={tool.callId} className={styles.toolItem}>
                  <span aria-hidden className={tool.status === "FAILED" ? styles.toolFailed : styles.toolStatus}>{pending ? running ? <LoadingOutlined spin /> : <StopOutlined /> : tool.status === "FAILED" ? <CloseCircleOutlined /> : <CheckCircleOutlined />}</span>
                  <div className={styles.toolBody}>
                    <div className={styles.toolName}>{tool.displayName}<span className={styles.toolOutcome}>{status}</span>{duration !== undefined ? <span className={styles.toolDuration}>{formatDuration(duration)}</span> : null}</div>
                    {tool.detail ? <div className={styles.toolDetail}>{tool.detail}</div> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
