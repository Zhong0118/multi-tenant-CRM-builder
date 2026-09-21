"use client";

import Link from "next/link";

import styles from "./ai-assistant.module.css";
import { sourceHref } from "./ai-copy";
import type { AiSourceSummary } from "./ai-types";

export function SourceCard({
  tenantCode,
  source,
}: {
  tenantCode: string;
  source: AiSourceSummary;
}) {
  const href = sourceHref(tenantCode, source);
  const title =
    source.kind === "AGGREGATE"
      ? `${source.objectName} · ${source.label}`
      : source.kind === "TIMELINE"
        ? `${source.objectName}${source.recordTitle ? ` · ${source.recordTitle}` : ""}`
        : source.objectName;
  const detail =
    source.kind === "AGGREGATE"
      ? source.value
      : source.kind === "RECORDS"
        ? `${source.count} 条`
        : `${source.count} 条活动`;
  return (
    <Link className={styles.sourceCard} href={href}>
      <strong>{title}</strong>
      <div>{detail}</div>
    </Link>
  );
}
