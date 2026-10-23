"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { followUpApi, followUpQueryKeys, type FollowUpWorkbench } from "./follow-up-api";

import styles from "./follow-ups.module.css";

/**
 * Leads the member claimed or was assigned and has not yet confirmed as
 * contacted. They come straight from the records' pool stage, so a claimed
 * lead shows up here at once and leaves when contact is confirmed, it is
 * released or the pool reclaims it. Shares the workbench query, so it costs no
 * extra request where the workbench is already on the page.
 */
export function PendingContacts({
  tenantCode,
  data,
  api = followUpApi,
  now = () => Date.now(),
}: {
  tenantCode: string;
  /** The workbench response when the caller already holds it. */
  data?: FollowUpWorkbench;
  api?: typeof followUpApi;
  now?: () => number;
}) {
  const query = useQuery({
    queryKey: followUpQueryKeys.workbench(tenantCode),
    queryFn: () => api.workbench(tenantCode),
    refetchInterval: 60_000,
    enabled: data === undefined,
  });
  const pending = (data ?? query.data)?.pendingContacts;
  if (!pending?.count) return null;

  return (
    <section className={styles.pendingContacts} aria-label="待联系客户">
      <div className={styles.pendingHeading}>
        <h2>待联系客户</h2>
        <span>{pending.count}</span>
        <p>领取或分配给你、还没确认建立联系的记录。期限前在记录页确认联系，否则会回到公共池。</p>
      </div>
      <ul className={styles.pendingList}>
        {pending.items.map((item) => {
          const left = new Date(item.expiresAt).getTime() - now();
          return (
            <li key={item.recordId}>
              <Link
                href={`/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(item.objectCode)}/${encodeURIComponent(item.recordId)}`}
              >
                {item.recordTitle}
              </Link>
              <span className={styles.muted}>
                {item.objectName} · {item.stageLabel}
              </span>
              <time
                dateTime={item.expiresAt}
                className={left < 3 * 3_600_000 ? styles.pendingUrgent : undefined}
              >
                {remaining(left)}
              </time>
            </li>
          );
        })}
      </ul>
      {pending.count > pending.items.length ? (
        <p className={styles.muted}>另有 {pending.count - pending.items.length} 条，按期限从近到远显示前 {pending.items.length} 条。</p>
      ) : null}
    </section>
  );
}

function remaining(ms: number): string {
  if (ms <= 0) return "已到期";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `剩 ${Math.max(1, Math.round(ms / 60_000))} 分钟`;
  if (hours < 48) return `剩 ${hours} 小时`;
  return `剩 ${Math.floor(hours / 24)} 天`;
}
