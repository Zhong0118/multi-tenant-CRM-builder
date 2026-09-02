import { describe, expect, it } from "vitest";

import { layoutDashboardWidgets } from "./layout-dashboard-widgets";

describe("layoutDashboardWidgets", () => {
  it("groups widgets into type bands and keeps sortOrder inside each band", () => {
    const layout = layoutDashboardWidgets([
      { id: "records", type: "RECORD_LIST", sortOrder: 5 },
      { id: "total", type: "METRIC", sortOrder: 1 },
      { id: "status", type: "STATUS_DISTRIBUTION", sortOrder: 2 },
      { id: "trend", type: "TREND", sortOrder: 3 },
      { id: "leaderboard", type: "LEADERBOARD", sortOrder: 4 },
      { id: "unavailable", type: "METRIC", sortOrder: 6 },
    ]);

    expect(layout.metrics.map((widget) => widget.id)).toEqual([
      "total",
      "unavailable",
    ]);
    expect(layout.primaryTrend?.id).toBe("trend");
    expect(layout.extraTrends).toEqual([]);
    expect(layout.distributions.map((widget) => widget.id)).toEqual(["status"]);
    expect(layout.leaderboards.map((widget) => widget.id)).toEqual([
      "leaderboard",
    ]);
    expect(layout.recordLists.map((widget) => widget.id)).toEqual(["records"]);
  });

  it("pairs the first trend with all distributions and wraps extra trends", () => {
    const layout = layoutDashboardWidgets([
      { id: "trend-b", type: "TREND", sortOrder: 4 },
      { id: "dist-b", type: "STATUS_DISTRIBUTION", sortOrder: 3 },
      { id: "trend-a", type: "TREND", sortOrder: 1 },
      { id: "dist-a", type: "STATUS_DISTRIBUTION", sortOrder: 2 },
    ]);

    expect(layout.primaryTrend?.id).toBe("trend-a");
    expect(layout.extraTrends.map((widget) => widget.id)).toEqual(["trend-b"]);
    expect(layout.distributions.map((widget) => widget.id)).toEqual([
      "dist-a",
      "dist-b",
    ]);
  });

  it("omits empty bands when a tenant only publishes some widget types", () => {
    const layout = layoutDashboardWidgets([
      { id: "orders", type: "RECORD_LIST", sortOrder: 2 },
      { id: "count", type: "METRIC", sortOrder: 1 },
    ]);

    expect(layout.metrics.map((widget) => widget.id)).toEqual(["count"]);
    expect(layout.primaryTrend).toBeNull();
    expect(layout.extraTrends).toEqual([]);
    expect(layout.distributions).toEqual([]);
    expect(layout.leaderboards).toEqual([]);
    expect(layout.recordLists.map((widget) => widget.id)).toEqual(["orders"]);
  });

  it("breaks sortOrder ties with the original widget index", () => {
    const layout = layoutDashboardWidgets([
      { id: "second", type: "METRIC", sortOrder: 1 },
      { id: "first", type: "METRIC", sortOrder: 1 },
    ]);

    expect(layout.metrics.map((widget) => widget.id)).toEqual([
      "second",
      "first",
    ]);
  });
});
