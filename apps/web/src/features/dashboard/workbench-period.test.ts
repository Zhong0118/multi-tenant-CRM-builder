import { describe, expect, it } from "vitest";

import {
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
  it("matches a range back to the preset that produced it", () => {
    const now = new Date("2026-09-03T08:30:00.000Z");
    const range = workbenchPeriodRange("this_month", "Asia/Shanghai", now);
    expect(
      workbenchPeriodPreset(range, "Asia/Shanghai", now),
    ).toBe("this_month");
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
    expect(dashboardSettingsPath("northwind", "sales")).toBe(
      "/workspace/northwind/settings/dashboards/sales",
    );
    expect(dashboardSettingsPath("northwind")).toBe(
      "/workspace/northwind/settings/dashboards/home",
    );
  });
});
