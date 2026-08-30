"use client";

import { Bar, DualAxes } from "@ant-design/charts";

import type { DashboardOverview } from "./dashboard-types";

const COLORS: Record<string, string> = {
  GRAY: "#7c8992",
  BLUE: "#3478f6",
  CYAN: "#0891b2",
  GREEN: "#16855b",
  YELLOW: "#ca8a04",
  ORANGE: "#c66c18",
  RED: "#b42318",
  PURPLE: "#7c3aed",
};

export function PipelineChart({
  data,
}: {
  data: DashboardOverview["pipeline"];
}) {
  return (
    <Bar
      height={280}
      autoFit
      data={data.map((item) => ({
        ...item,
        chartColor: COLORS[item.color] ?? COLORS.GRAY,
      }))}
      xField="count"
      yField="label"
      colorField="chartColor"
      scale={{ color: { type: "identity" } }}
      axis={{ x: { title: false }, y: { title: false } }}
      legend={false}
      label={{ text: "count", position: "right", style: { fill: "#17232d" } }}
      tooltip={{
        items: [
          { field: "count", name: "记录数" },
          { field: "amount", name: "金额" },
        ],
      }}
      style={{ maxWidth: 28, radius: 3 }}
    />
  );
}

export function TrendChart({ data }: { data: DashboardOverview["trend"] }) {
  return (
    <DualAxes
      height={260}
      autoFit
      data={[data, data]}
      xField="date"
      yField={["wonAmount", "wonCount"]}
      geometryOptions={[
        {
          geometry: "column",
          color: "#167568",
          columnWidthRatio: 0.45,
        },
        {
          geometry: "line",
          color: "#c66c18",
          lineStyle: { lineWidth: 2 },
        },
      ]}
      axis={{
        x: { title: false },
        y: { title: false },
      }}
      legend={{ position: "top-right" }}
      tooltip={{ shared: true }}
    />
  );
}
