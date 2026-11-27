"use client";

import { Alert, Empty, Skeleton } from "antd";

import { StatusTag } from "@/components/workbench/status-tag";
import { formatDateTime } from "@/features/records/record-display-value";
import { toApiError } from "@/lib/api/api-error";

import {
  CALL_STATUS,
  formatDuration,
  formatPhone,
  type TelephonyCallPage,
} from "./telephony-api";
import styles from "./telephony.module.css";

/** The calls on one record, newest first: result, length, who, when, recording. */
export function RecordCallsPanel({
  calls,
  error,
  timeZone,
}: {
  calls?: TelephonyCallPage;
  error?: unknown;
  timeZone?: string;
}) {
  if (error)
    return <Alert type="error" showIcon title={toApiError(error).message} />;
  if (!calls) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  if (!calls.items.length)
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有通话" />
    );
  return (
    <ul className={styles.callList}>
      {calls.items.map((call) => {
        const status = CALL_STATUS[call.status] ?? CALL_STATUS.ENDED;
        return (
          <li key={call.id} className={styles.callRow}>
            <StatusTag tone={status.tone}>{status.label}</StatusTag>
            <span className={styles.callMain}>
              {[
                formatDuration(call.durationSeconds),
                call.status === "FAILED" ? call.failureReason : null,
                call.actorName,
                formatPhone(call.calleePhone),
                call.mode === "MOCK" ? "模拟" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {call.recordingUrl ? (
              <a
                className={styles.recording}
                href={call.recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                录音
              </a>
            ) : null}
            <time className={styles.callTime} dateTime={call.createdAt}>
              {formatDateTime(call.createdAt, timeZone).slice(5)}
            </time>
          </li>
        );
      })}
      {calls.total > calls.items.length ? (
        <li className={styles.callMore}>
          只显示最近 {calls.items.length} 通，共 {calls.total} 通
        </li>
      ) : null}
    </ul>
  );
}
