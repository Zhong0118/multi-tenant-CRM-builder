"use client";

import { ArrowRightOutlined, BarChartOutlined, HistoryOutlined, TableOutlined } from "@ant-design/icons";
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
      ? formatAggregate(source.value)
      : source.kind === "RECORDS"
        ? `${source.count} 条记录`
        : `${source.count} 条活动`;
  const Glyph = source.kind === "AGGREGATE" ? BarChartOutlined : source.kind === "TIMELINE" ? HistoryOutlined : TableOutlined;
  return (
    <Link className={styles.sourceCard} href={href}>
      <span className={styles.sourceGlyph} aria-hidden>
        <Glyph />
      </span>
      <span>
        <span className={styles.sourceTitle}>{title}</span>
        <span className={styles.sourceDetail}>{detail}</span>
      </span>
      <span className={styles.sourceArrow} aria-hidden>
        <ArrowRightOutlined />
      </span>
    </Link>
  );
}

/** A plain number from the API reads with grouping (255,000); anything else as given. */
function formatAggregate(value: unknown): string {
  const text = String(value ?? "");
  return /^-?\d+(\.\d+)?$/.test(text)
    ? Number(text).toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : text;
}
