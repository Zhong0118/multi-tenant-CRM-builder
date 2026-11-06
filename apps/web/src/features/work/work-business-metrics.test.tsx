import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { components } from "@crm/contracts";
import { WorkBusinessMetrics } from "./work-business-metrics";
const data: components["schemas"]["DashboardRuntimeDto"] = {
  title: "业务数据",
  period: {
    from: "2026-11-05T00:00:00Z",
    to: "2026-11-06T00:00:00Z",
    timezone: "Asia/Shanghai",
  },
  widgets: [
    {
      id: "new",
      type: "METRIC",
      title: "新客",
      state: "READY",
      width: "QUARTER",
      sortOrder: 0,
      objectCode: "customer",
      data: { value: 5, members: [{ memberId: "one", value: 5 }] },
    },
    {
      id: "orders",
      type: "METRIC",
      title: "开单",
      state: "UNAVAILABLE",
      width: "QUARTER",
      sortOrder: 1,
      objectCode: "orders",
      reason: "QUERY_FAILED",
    },
  ],
};
describe("Shared workbench business metrics", () => {
  it("keeps percentage formatting consistent with the workbench", () => {
    render(
      <WorkBusinessMetrics
        data={{
          ...data,
          widgets: [
            {
              id: "rate",
              type: "METRIC",
              title: "比率",
              objectCode: "orders",
              state: "READY",
              width: "QUARTER",
              sortOrder: 0,
              data: { value: 25, format: "PERCENT", members: [] },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("25.0%")).toBeVisible();
  });
  it("shows personal statistics separately from unavailable metrics", () => {
    render(<WorkBusinessMetrics data={data} />);
    expect(screen.getByText("新客")).toBeVisible();
    expect(screen.getByText("5")).toBeVisible();
    expect(screen.getByText("暂不可用")).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  it("maps company aggregates to members, including zero-work members, without inventing failed counts", () => {
    render(
      <WorkBusinessMetrics
        data={data}
        members={[
          { memberId: "one", name: "刘洋" },
          { memberId: "two", name: "赵晨" },
        ]}
      />,
    );
    const row = screen.getByText("赵晨").closest("tr")!;
    expect(within(row).getByText("0")).toBeVisible();
    expect(within(row).getByText("暂不可用")).toBeVisible();
  });
  it("keeps older companies unchanged when there are no opted-in cards", () => {
    const view = render(
      <WorkBusinessMetrics data={{ ...data, widgets: [] }} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });
});
