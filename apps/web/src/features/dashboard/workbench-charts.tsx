"use client";

import { Line } from "@ant-design/charts";

export function TrendChart({ data }: { data: Array<{ date: string; value: number }> }) {
  return (
    <Line
      height={260}
      autoFit
      data={data}
      xField="date"
      yField="value"
      axis={{ x: { title: false }, y: { title: false } }}
      color="#167568"
      style={{ lineWidth: 2 }}
    />
  );
}
