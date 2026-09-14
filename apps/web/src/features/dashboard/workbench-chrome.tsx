"use client";

import Link from "next/link";

import { StatusTag } from "@/components/workbench/status-tag";
import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import type { DashboardListItem, DashboardRuntime } from "./dashboard-types";
import {
  WORKBENCH_PERIOD_PRESETS,
  workbenchPath,
  workbenchPeriodHref,
  workbenchPeriodPreset,
  workbenchPeriodRange,
} from "./workbench-period";
import styles from "./workbench.module.css";

export function WorkbenchPeriodNav({
  pathname,
  period,
  publication,
}: {
  pathname: string;
  period: DashboardRuntime["period"];
  publication?: { number: number; publishedAt: string };
}) {
  // Anchor the preset links to the range the page was rendered with, never to a
  // clock read during render: the server and the client would otherwise produce
  // different hrefs and React would report a hydration mismatch.
  const anchor = new Date(period.to);
  const current = workbenchPeriodPreset(period, period.timezone);
  return (
    <nav className={styles.periodNav} aria-label="趋势时间范围">
      <span>趋势时间范围</span>
      <PeriodLabel period={period} publication={publication} />
      {WORKBENCH_PERIOD_PRESETS.map((preset) => (
        <Link
          key={preset.key}
          href={workbenchPeriodHref(
            pathname,
            workbenchPeriodRange(preset.key, period.timezone, anchor),
          )}
          aria-current={current === preset.key ? "true" : undefined}
        >
          {preset.label}
        </Link>
      ))}
      <small className={styles.periodHint}>
        仅影响趋势图，其余指标按各组件筛选条件统计。
      </small>
    </nav>
  );
}

export function WorkbenchSwitcher({
  tenantCode,
  currentCode,
  dashboards,
}: {
  tenantCode: string;
  currentCode?: string;
  dashboards?: DashboardListItem[];
}) {
  const visible = (dashboards ?? []).filter(
    (dashboard) => dashboard.status === "ACTIVE",
  );
  if (visible.length < 2) return null;
  return (
    <nav className={styles.workbenchSwitcher} aria-label="工作台">
      {visible.map((dashboard) => (
        <Link
          key={dashboard.code}
          href={workbenchPath(tenantCode, dashboard.code)}
          aria-current={dashboard.code === currentCode ? "page" : undefined}
        >
          {dashboard.name}
        </Link>
      ))}
    </nav>
  );
}

export function PeriodLabel({
  period,
  publication,
}: {
  period: DashboardRuntime["period"];
  publication?: { number: number; publishedAt: string };
}) {
  return (
    <StatusTag tone="neutral">
      {formatDate(period.from)} 至 {formatDate(period.to)}
      {publication
        ? ` · 发布 #${publication.number}（${formatDate(publication.publishedAt)}）`
        : " · 已发布"}
    </StatusTag>
  );
}

export function EmployeeShortcuts({
  tenantCode,
  objects,
}: {
  tenantCode: string;
  objects: RuntimeObjectNavigation[];
}) {
  if (!objects.length) return null;
  return (
    <section className={styles.shortcuts} aria-label="快捷操作">
      {objects.map((object) => (
        <span key={object.code} className={styles.shortcutGroup}>
          {object.canCreate ? (
            <Link href={`/workspace/${tenantCode}/objects/${object.code}/new`}>
              {`新建${object.name}`}
            </Link>
          ) : null}
          <Link href={`/workspace/${tenantCode}/objects/${object.code}`}>
            {`打开${object.name}`}
          </Link>
        </span>
      ))}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}
