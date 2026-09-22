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
        ? `${source.count} 条记录`
        : `${source.count} 条活动`;
  const glyph = source.objectName.slice(0, 1);
  return (
    <Link className={styles.sourceCard} href={href}>
      <span className={styles.sourceGlyph} aria-hidden>
        {glyph}
      </span>
      <span>
        <span className={styles.sourceTitle}>{title}</span>
        <span className={styles.sourceDetail}>{detail}</span>
      </span>
      <span className={styles.sourceArrow} aria-hidden>
        →
      </span>
    </Link>
  );
}
