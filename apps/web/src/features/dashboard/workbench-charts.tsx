"use client";

import { Line } from "@ant-design/charts";

import styles from "./workbench.module.css";

export function TrendChart({
  title,
  data,
}: {
  title: string;
  data: Array<{ date: string; value: number }>;
}) {
  if (data.length === 1)
    return (
      <div className={styles.singleTrend}>
        <span>{data[0].date}</span>
        <strong>{new Intl.NumberFormat("zh-CN").format(data[0].value)}</strong>
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
          axis={{ x: { title: false }, y: { title: false } }}
          color="#167568"
          style={{ lineWidth: 2 }}
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
              <td>{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
