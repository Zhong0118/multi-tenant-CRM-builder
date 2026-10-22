import { describe, expect, it } from "vitest";

import {
  parseDashboardFilter,
  parseDraft,
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

const incompleteWidgets = [
  { type: "METRIC", aggregation: "COUNT" },
  {
    type: "STATUS_DISTRIBUTION",
    groupByFieldKey: "",
    optionKeys: [],
    display: "BAR",
    aggregation: "COUNT",
  },
  {
    type: "TREND",
    dateFieldKey: "",
    granularity: "AUTO",
    aggregation: "COUNT",
  },
  {
    type: "LEADERBOARD",
    memberSource: "FIELD",
    memberFieldKey: "",
    aggregation: "SUM",
    valueFieldKey: "",
    limit: 10,
  },
  {
    type: "RECORD_LIST",
    fieldKeys: [],
    sort: { field: "", direction: "DESC" },
    limit: 10,
  },
].map((widget, index) => ({
  id: `widget-${index}`,
  title: "",
  objectCode: "",
  audience: "ALL",
  width: "HALF",
  sortOrder: index,
  filters: [{ fieldKey: "", operator: "NOT_EMPTY" }],
  ...widget,
}));

function incompleteDraft(widget: unknown) {
  return {
    id: "dashboard-id",
    code: "home",
    name: "工作台",
    status: "ACTIVE",
    audience: "ALL",
    sortOrder: 0,
    draftVersion: 2,
    draftConfiguration: { schemaVersion: 2, title: "", widgets: [widget] },
    activePublicationId: "publication-id",
    sourceTemplateVersionId: null,
    updatedAt: "2026-10-13T00:00:00.000Z",
  };
}

describe("unfinished dashboard draft round trip", () => {
  it.each(incompleteWidgets)(
    "reopens a saved $type widget with incomplete bindings",
    (widget) => {
      const draft = incompleteDraft(widget);
      const issues = [
        {
          code: "OBJECT_REQUIRED",
          path: "widgets.0.objectCode",
          message: "请选择业务表",
        },
      ];
      const parsed = parseDashboardConfigurationView({
        timezone: "Asia/Shanghai",
        dashboards: [],
        dashboard: null,
        draft,
        activePublication: null,
        candidates: [],
        issues,
      } as never);
      expect(parsed.draft).toEqual(draft);
      expect(parsed.issues).toEqual(issues);
      // Save and copy responses use the same parser without an envelope.
      expect(parseDraft(draft)).toEqual(draft);
    },
  );

  it("still rejects a non-string draft binding", () => {
    expect(() =>
      parseDraft(incompleteDraft({ ...incompleteWidgets[0], objectCode: 42 })),
    ).toThrow("Invalid dashboard response");
  });

  it("still rejects empty object bindings in published runtime widgets", () => {
    expect(() =>
      parseDashboardRuntime({
        title: "工作台",
        period: {
          from: "2026-10-01",
          to: "2026-10-13",
          timezone: "Asia/Shanghai",
        },
        widgets: [
          {
            ...incompleteWidgets[0],
            title: "数量",
            state: "READY",
            data: { value: 1 },
          },
        ],
      }),
    ).toThrow("Invalid dashboard response");
  });
});

it("retains archived widgets alongside live results", () => {
  const widgets = [
    { id: "stopped", type: "METRIC", title: "客户", objectCode: "customers", width: "HALF", sortOrder: 0, state: "UNAVAILABLE", reason: "OBJECT_ARCHIVED" },
    { id: "live", type: "METRIC", title: "订单", objectCode: "orders", width: "HALF", sortOrder: 1, state: "READY", data: { value: 7 } },
  ];
  expect(parseDashboardRuntime({ title: "工作台", period: { from: "2026-10-01", to: "2026-10-20", timezone: "Asia/Shanghai" }, widgets }).widgets).toEqual(widgets);
});
