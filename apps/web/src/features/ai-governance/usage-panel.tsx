"use client";
import { formatPercent, formatTokens } from "@/features/ai-governance/format";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button, Empty, Progress } from "antd";
import { PageSection } from "@/components/layout/page";
import { MemberIdentity } from "@/components/identity/member-identity";
import {
  catalogLabels,
  type Settings,
  type Usage,
  type AiFeature,
} from "./workspace-api";
import { quotaColor } from "./view-feedback";
import styles from "./settings.module.css";

const Trend = dynamic(
  () =>
    import("@/features/dashboard/workbench-charts").then((m) => m.TrendChart),
  { ssr: false },
);
export function UsagePanel({
  state,
  usage,
}: {
  state: Settings;
  usage: Usage;
}) {
  const featureNames = catalogLabels(state.catalog);
  const [everyone, setEveryone] = useState(false);
  const byDay = new Map<string, number>(),
    byFeature = new Map<AiFeature, number>();
  let proposals = 0,
    confirmed = 0;
  for (const d of usage.daily) {
    const count = Number(d.inputTokens) + Number(d.outputTokens);
    if (count) {
      byDay.set(d.date, (byDay.get(d.date) ?? 0) + count);
      byFeature.set(d.feature, (byFeature.get(d.feature) ?? 0) + count);
    }
    proposals += Number(d.proposals);
    confirmed += Number(d.confirmations);
  }
  if (!byDay.size && !proposals && !confirmed)
    return <Empty description="本月还没有使用 AI" />;
  // Daily totals past ten thousand read in 万 on the axis.
  const inWan = Math.max(0, ...byDay.values()) >= 10_000;
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  // Members who have not used AI this month wait behind 显示全部.
  const idle = usage.members.filter((m) => !Number(m.usedTokens)).length;
  const shown = everyone
    ? usage.members
    : usage.members.filter((m) => Number(m.usedTokens) > 0);
  const share =
    state.allocation === "equal" && state.preview.shareTokens !== null
      ? Number(state.preview.shareTokens)
      : null;
  return (
    <>
      <div className={styles.grid}>
        <PageSection title="每日用量">
          {byDay.size >= 7 ? (
            <Trend
              title="用量"
              formatValue={formatTokens}
              // Ticks carry their unit: "80万", or bare token counts.
              formatAxis={(value) =>
                new Intl.NumberFormat("zh-CN", {
                  maximumFractionDigits: 1,
                }).format(inWan ? value / 10_000 : value) + (inWan ? "万" : "")
              }
              zeroBaseline
              data={days.map(([date, value]) => ({ date, value }))}
            />
          ) : byDay.size > 0 ? (
            // Under a week a line says little; the days read as numbers.
            days.map(([date, value]) => (
              <div key={date} className={styles.featureUsage}>
                <span>{dayLabel(date)}</span>
                <b>{formatTokens(value)}</b>
                <Progress
                  size="small"
                  status="normal"
                  percent={(100 * value) / Math.max(1, ...byDay.values())}
                  showInfo={false}
                />
              </div>
            ))
          ) : (
            <p>本月暂无模型调用用量</p>
          )}
        </PageSection>
        <PageSection title="功能用量">
          {[...byFeature.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([feature, n]) => (
              <div key={feature} className={styles.featureUsage}>
                <span>{featureNames[feature]}</span>
                <b>{formatTokens(n)}</b>
                <Progress
                  size="small"
                  percent={Math.min(
                    100,
                    (100 * n) / Math.max(1, Number(state.usedTokens)),
                  )}
                  showInfo={false}
                />
              </div>
            ))}
          <p className={styles.helper}>
            AI 写入提议 {proposals} 项 · 已确认 {confirmed} 项
          </p>
        </PageSection>
      </div>
      <PageSection title="成员用量">
        <ul className={styles.members}>
          {shown.map((m) => {
            const limit = share ?? Number(state.totalTokens),
              percent = limit > 0 ? (100 * Number(m.usedTokens)) / limit : 0;
            return (
              <li key={m.memberId}>
                <MemberIdentity
                  member={{
                    id: m.memberId,
                    displayName: m.name,
                    status: m.active ? "ACTIVE" : "DISABLED",
                  }}
                />
                <span>
                  {formatTokens(m.usedTokens)}
                  {share !== null && <small> / {formatTokens(share)}</small>}
                </span>
                <span style={{ color: quotaColor(percent) }}>
                  {formatPercent(percent)}
                </span>
              </li>
            );
          })}
        </ul>
        {idle > 0 && !everyone && (
          <Button
            type="link"
            className={styles.showAll}
            onClick={() => setEveryone(true)}
          >
            显示全部 {usage.members.length} 人
          </Button>
        )}
      </PageSection>
    </>
  );
}

/** "2026-11-25" → "11月25日". */
function dayLabel(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日`;
}
