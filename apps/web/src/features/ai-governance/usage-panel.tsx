"use client";
import { formatPercent, formatTokens } from "@/features/ai-governance/format";
import dynamic from "next/dynamic";
import { Empty, Progress } from "antd";
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
  const share =
    state.allocation === "equal" && state.preview.shareTokens !== null
      ? Number(state.preview.shareTokens)
      : null;
  return (
    <>
      <div className={styles.grid}>
        <PageSection
          title="每日用量趋势"
          description="每天结算的输入与输出 token，单位：token"
        >
          {byDay.size > 0 ? (
            <Trend
              title="用量"
              formatValue={formatTokens}
              formatAxis={(value) =>
                formatTokens(value).replace(/\s*token$/, "")
              }
              zeroBaseline
              data={[...byDay.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, value]) => ({ date, value }))}
            />
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
          {usage.members.map((m) => {
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
      </PageSection>
    </>
  );
}
