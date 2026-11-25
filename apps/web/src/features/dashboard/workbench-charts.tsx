"use client";

import { Line } from "@ant-design/charts";

import styles from "./workbench.module.css";
import { WORKSPACE_TOKENS } from "@/components/theme/workspace-theme";

export function TrendChart({
  title,
  data,
  formatValue,
}: {
  title: string;
  formatValue?: (value: number) => string;
  data: Array<{ date: string; value: number }>;
}) {
  if (data.length === 1)
    return (
      <div className={styles.singleTrend}>
        <span>{data[0].date}</span>
        <strong>
          {formatValue
            ? formatValue(data[0].value)
            : new Intl.NumberFormat("zh-CN").format(data[0].value)}
        </strong>
        <p>当前范围仅有一个时间点，积累更多数据后显示趋势。</p>
      </div>
    );
  return (
    <>
      <div role="img" aria-label={`${title}趋势图`}>
        <Line
          height={220}
          autoFit
          data={data}
          xField="date"
          yField="value"
          axis={{
            x: { title: false },
            y: {
              title: false,
              ...(formatValue && {
                labelFormatter: (v: number | string) => formatValue(Number(v)),
              }),
            },
          }}
          tooltip={
            formatValue && {
              items: [
                { name: title, field: "value", valueFormatter: formatValue },
              ],
            }
          }
          color={WORKSPACE_TOKENS.primary}
          // A constant colour is a mark style in G2 5; `color` alone left the
          // line in the default blue.
          style={{ stroke: WORKSPACE_TOKENS.primary, lineWidth: 2 }}
        />
      </div>
      <table className={styles.screenReaderOnly} aria-label={`${title}数据`}>
        <caption>{title}数据</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.date}>
              <td>{item.date}</td>
              <td>{formatValue ? formatValue(item.value) : item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
