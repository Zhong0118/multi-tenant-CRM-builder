"use client";
import { formatTokens, formatPercent } from "@/features/ai-governance/format";
import { Column } from "@ant-design/charts";
import { names, type Summary, type Feature } from "./common";
import styles from "./platform-ai.module.css";
export function UsageCharts({ summary }: { summary: Summary }) {
  const totals = new Map<Feature, bigint>();
  let proposals = BigInt(0),
    confirmations = BigInt(0);
  for (const row of summary.usage) {
    totals.set(
      row.feature,
      (totals.get(row.feature) || BigInt(0)) +
        BigInt(row.inputTokens) +
        BigInt(row.outputTokens),
    );
    proposals += BigInt(row.proposals);
    confirmations += BigInt(row.confirmations);
  }
  return (
    <div className={styles.charts}>
      <section>
        <h4>近六个月用量</h4>
        <Column
          height={180}
          data={summary.trend.map((r) => ({
            month: r.month.slice(0, 7),
            value: Number(r.usedTokens),
          }))}
          xField="month"
          yField="value"
          axis={{
            y: {
              title: false,
              labelFormatter: (v: number | string) => formatTokens(Number(v)),
            },
            x: { title: false },
          }}
          tooltip={{
            items: [
              { name: "用量", field: "value", valueFormatter: formatTokens },
            ],
          }}
        />
      </section>
      <section>
        <h4>本月功能分布</h4>
        {[...totals]
          .filter(([, sum]) => sum > BigInt(0))
          .map(([f, sum]) => (
            <div key={f} className={styles.line}>
              <span>{names[f]}</span>
              <strong>
                {formatTokens(sum)} ·{" "}
                {formatPercent(
                  (Number(sum) / Math.max(1, Number(summary.usedTokens))) * 100,
                )}
              </strong>
            </div>
          ))}
        <p>
          写入提议 {proposals.toString()} 项 · 已确认 {confirmations.toString()}{" "}
          项
        </p>
      </section>
    </div>
  );
}
