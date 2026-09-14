import { describe, expect, it } from "vitest";

import {
  WORKBENCH_PERIOD_PRESETS,
  dashboardSettingsPath,
  workbenchPath,
  workbenchPeriodHref,
  workbenchPeriodPreset,
  workbenchPeriodRange,
} from "./workbench-period";

describe("workbenchPeriodRange", () => {
  const now = new Date("2026-09-03T08:30:00.000Z");

  it("uses tenant-calendar bounds for this month and this week", () => {
    expect(workbenchPeriodRange("this_month", "Asia/Shanghai", now)).toEqual({
      from: "2026-08-31T16:00:00.000Z",
      to: "2026-09-03T08:30:00.000Z",
    });
    expect(workbenchPeriodRange("this_week", "Asia/Shanghai", now)).toEqual({
      from: "2026-08-30T16:00:00.000Z",
      to: "2026-09-03T08:30:00.000Z",
    });
  });

  it("uses rolling UTC windows for the past-day presets", () => {
    expect(workbenchPeriodRange("past_7_days", "Asia/Shanghai", now)).toEqual({
      from: "2026-08-27T08:30:00.000Z",
      to: "2026-09-03T08:30:00.000Z",
    });
    expect(workbenchPeriodRange("past_30_days", "Asia/Shanghai", now)).toEqual({
      from: "2026-08-04T08:30:00.000Z",
      to: "2026-09-03T08:30:00.000Z",
    });
  });
});

describe("workbenchPeriodPreset", () => {
  const now = new Date("2026-09-03T08:30:00.000Z");

  it("matches a range back to the preset that produced it", () => {
    for (const { key } of WORKBENCH_PERIOD_PRESETS) {
      const range = workbenchPeriodRange(key, "Asia/Shanghai", now);
      expect(workbenchPeriodPreset(range, "Asia/Shanghai")).toBe(key);
    }
  });

  it("still matches after the clock has moved past the range it produced", () => {
    // The header is rendered from a range that was produced by an earlier
    // clock; reverse-mapping must not depend on the current time.
    const range = workbenchPeriodRange("past_30_days", "Asia/Shanghai", now);
    expect(workbenchPeriodPreset(range, "Asia/Shanghai")).toBe("past_30_days");
  });

  it("prefers the narrower window when a month begins on a Monday", () => {
    // 2026-06-01 is a Monday, so that week and that month start on the same
    // instant and the URL cannot distinguish them.
    const monday = new Date("2026-06-01T08:30:00.000Z");
    const month = workbenchPeriodRange("this_month", "Asia/Shanghai", monday);
    const week = workbenchPeriodRange("this_week", "Asia/Shanghai", monday);
    expect(month).toEqual(week);
    expect(workbenchPeriodPreset(month, "Asia/Shanghai")).toBe("this_week");
  });

  it("returns null for a range no preset produces", () => {
    expect(
      workbenchPeriodPreset(
        {
          from: "2026-01-09T08:30:00.000Z",
          to: "2026-01-24T08:30:00.000Z",
        },
        "Asia/Shanghai",
      ),
    ).toBeNull();
    expect(
      workbenchPeriodPreset({ from: "not-a-date", to: "nope" }, "Asia/Shanghai"),
    ).toBeNull();
  });
});

describe("workbenchPeriodHref", () => {
  it("keeps the current dashboard path and writes from/to query params", () => {
    const href = workbenchPeriodHref("/workspace/northwind/dashboards/sales", {
      from: "2026-08-31T16:00:00.000Z",
      to: "2026-09-03T08:30:00.000Z",
    });
    expect(href).toBe(
      "/workspace/northwind/dashboards/sales?from=2026-08-31T16%3A00%3A00.000Z&to=2026-09-03T08%3A30%3A00.000Z",
    );
  });

  it("builds workspace and settings paths from the selected dashboard code", () => {
    expect(workbenchPath("northwind", "sales")).toBe(
      "/workspace/northwind/dashboards/sales",
    );
    expect(workbenchPath("northwind", "home")).toBe("/workspace/northwind");
    expect(dashboardSettingsPath("northwind", "sales")).toBe(
      "/workspace/northwind/settings/dashboards/sales",
    );
    expect(dashboardSettingsPath("northwind")).toBe(
      "/workspace/northwind/settings/dashboards/home",
    );
  });
});
