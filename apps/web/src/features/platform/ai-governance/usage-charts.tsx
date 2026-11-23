"use client";
import { Column } from "@ant-design/charts";
import { names, wan, type Summary, type Feature } from "./common";
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
        <h4>近六个月用量（万 token）</h4>
        <Column
          height={180}
          data={summary.trend.map((r) => ({
            month: r.month.slice(0, 7),
            value: Number(r.usedTokens) / 10000,
          }))}
          xField="month"
          yField="value"
          axis={{ y: { title: false }, x: { title: false } }}
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
                {wan(sum.toString())} 万 token ·{" "}
                {Math.round(
                  (Number(sum) / Math.max(1, Number(summary.usedTokens))) * 100,
                )}
                %
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
