import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { DashboardWidgetInspector } from "./dashboard-widget-inspector";
import { parseDraft, type DashboardWidgetDraft } from "./dashboard-types";

it("preserves report attribution and text-date filters when loading a saved draft", () => {
  const metric = {
    id: "wechat",
    type: "METRIC",
    title: "新增微信",
    audience: "ALL",
    objectCode: "passes",
    width: "QUARTER",
    sortOrder: 0,
    aggregation: "COUNT",
    workReport: { memberSource: "RECORD_OWNER" },
    filters: [
      { fieldKey: "passed_at", operator: "DASHBOARD_PERIOD" },
      { fieldKey: "passed", operator: "EQ", value: true },
    ],
  };
  const draft = parseDraft({
    id: "home",
    code: "home",
    name: "工作台",
    status: "ACTIVE",
    audience: "ALL",
    sortOrder: 0,
    draftVersion: 2,
    updatedAt: "2026-11-06T00:00:00Z",
    activePublicationId: null,
    sourceTemplateVersionId: null,
    draftConfiguration: {
      schemaVersion: 2,
      title: "工作台",
      widgets: [metric],
    },
  });
  expect(draft.draftConfiguration.widgets).toEqual([metric]);
});

it("opts a metric into reports with explicit attribution without changing its business filters", () => {
  let changed: DashboardWidgetDraft;
  function Editor() {
    const [widget, setWidget] = useState<DashboardWidgetDraft>({
      id: "new",
      type: "METRIC",
      title: "新客",
      audience: "ALL",
      objectCode: "customer",
      width: "QUARTER",
      sortOrder: 0,
      filters: [],
      aggregation: "COUNT",
    });
    return (
      <DashboardWidgetInspector
        widget={widget}
        candidates={[]}
        tenantTimezone="Asia/Shanghai"
        onChange={(next) => {
          changed = next;
          setWidget(next);
        }}
      />
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByLabelText("用于任务与日报"));
  expect(changed!).toMatchObject({
    workReport: { memberSource: "CREATOR" },
    filters: [],
  });
  fireEvent.change(screen.getByLabelText("业绩归属"), {
    target: { value: "RECORD_OWNER" },
  });
  expect(changed!).toMatchObject({
    workReport: { memberSource: "RECORD_OWNER" },
  });
  expect(screen.getAllByText(/跟随工作台时段/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByLabelText("用于任务与日报"));
  expect(changed!).not.toHaveProperty("workReport");
});
