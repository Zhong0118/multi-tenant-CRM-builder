import { describe, expect, it } from "vitest";

import {
  parseDashboardFilter,
  parseDashboardConfigurationView,
  parseDashboardOverview,
  parseDashboardRuntime,
} from "./dashboard-types";

describe("dashboard runtime parsing", () => {
  it("requires the authoritative tenant timezone in the configuration envelope", () => {
    expect(
      parseDashboardConfigurationView({
        timezone: "Asia/Shanghai",
        dashboards: [],
        dashboard: null,
        draft: null,
        activePublication: null,
        candidates: [],
        issues: [],
      } as never),
    ).toEqual({
      timezone: "Asia/Shanghai",
      dashboards: [],
      dashboard: null,
      draft: null,
      activePublication: null,
      candidates: [],
      issues: [],
    });
  });

  it("keeps field-aware filter mistakes structurally parseable for server issues", () => {
    expect(
      parseDashboardFilter({
        fieldKey: "closedAt",
        operator: "PAST_N_DAYS",
        value: 0,
      }),
    ).toEqual({
      fieldKey: "closedAt",
      operator: "PAST_N_DAYS",
      value: 0,
    });
  });

  it("rejects runtime widgets without required V2 object bindings", () => {
    expect(() =>
      parseDashboardRuntime({
        title: "工作台",
        period: {
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-08-31T00:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        widgets: [
          {
            id: "metric",
            type: "METRIC",
            title: "总数",
            width: "QUARTER",
            sortOrder: 0,
            state: "READY",
            data: { value: 1 },
          },
        ],
      }),
    ).toThrow("Invalid dashboard response");
  });

  it("rejects malformed overview state instead of returning a partial runtime", () => {
    expect(() =>
      parseDashboardOverview({
        title: "工作台",
        period: {
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-08-31T00:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        widgets: [],
        state: "NEEDS_REPAIR",
        role: "TENANT_ADMIN",
      }),
    ).toThrow("Invalid dashboard response");
  });
});
