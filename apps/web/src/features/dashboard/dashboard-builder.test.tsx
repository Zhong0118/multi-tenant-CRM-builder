import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  previewDashboardDraft,
  publishDashboardDraft,
  saveDashboardDraft,
} from "./dashboard-api";
import { DashboardBuilder } from "./dashboard-builder";

vi.mock("./dashboard-api", () => ({
  saveDashboardDraft: vi.fn(),
  previewDashboardDraft: vi.fn(),
  publishDashboardDraft: vi.fn(),
}));

const initial = {
  draft: {
    draftVersion: 4,
    draftConfiguration: {
      schemaVersion: 2 as const,
      title: "销售工作台",
      widgets: [],
    },
    activePublicationId: "publication-3",
    sourceTemplateVersionId: null,
    updatedAt: "2026-09-01T01:00:00.000Z",
  },
  activePublication: {
    id: "publication-3",
    number: 3,
    sourceDraftVersion: 3,
    publishedAt: "2026-08-31T01:00:00.000Z",
  },
  candidates: [
    {
      object: { code: "deals", name: "商机" },
      fields: [
        {
          fieldKey: "amount",
          label: "金额",
          type: "MONEY",
          config: {},
        },
      ],
    },
  ],
  issues: [],
};

beforeEach(() => {
  vi.mocked(saveDashboardDraft).mockReset();
  vi.mocked(previewDashboardDraft).mockReset();
  vi.mocked(publishDashboardDraft).mockReset();
  vi.mocked(saveDashboardDraft).mockResolvedValue({
    ...initial.draft,
    draftVersion: 5,
  });
  vi.mocked(previewDashboardDraft).mockResolvedValue({
    title: "销售工作台",
    period: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
    widgets: [],
  });
  vi.mocked(publishDashboardDraft).mockResolvedValue({
    id: "publication-4",
    number: 4,
    sourceDraftVersion: 5,
    publishedAt: "2026-09-01T02:00:00.000Z",
  });
});

describe("DashboardBuilder", () => {
  it("adds each supported component type from the library", () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    for (const label of [
      "添加指标卡",
      "添加状态分布",
      "添加趋势图",
      "添加员工业绩排行",
      "添加记录列表",
    ]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }

    expect(screen.getAllByRole("article", { name: /组件/ })).toHaveLength(5);
    expect(screen.getByText("有未保存修改")).toBeInTheDocument();
  });

  it("selects, copies, and deletes a component without discarding the draft", () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "复制组件 指标卡 1" }));
    expect(screen.getAllByRole("article", { name: /组件/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "删除组件 指标卡 2" }));
    expect(screen.getAllByRole("article", { name: /组件/ })).toHaveLength(1);
    expect(screen.getByLabelText("当前组件")).toHaveValue("指标卡 1");
  });

  it("saves the local V2 draft with its server version and only then enables publishing", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    expect(screen.getByRole("button", { name: "发布工作台" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(saveDashboardDraft).toHaveBeenCalledWith("northwind", {
        expectedVersion: 4,
        configuration: expect.objectContaining({
          schemaVersion: 2,
          widgets: [expect.objectContaining({ type: "METRIC", sortOrder: 1 })],
        }),
      }),
    );
    expect(screen.getByRole("button", { name: "发布工作台" })).toBeEnabled();
  });

  it("focuses the affected component when an inline validation issue is opened", () => {
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={{
          ...initial,
          draft: {
            ...initial.draft,
            draftConfiguration: {
              ...initial.draft.draftConfiguration,
              widgets: [
                {
                  id: "metric-1",
                  type: "METRIC",
                  title: "本月商机",
                  audience: "ALL",
                  objectCode: "",
                  width: "QUARTER",
                  sortOrder: 1,
                  filters: [],
                  aggregation: "COUNT",
                  displayFormat: "NUMBER",
                },
              ],
            },
          },
          issues: [
            {
              code: "DASHBOARD_OBJECT_REQUIRED",
              path: "widgets[0].objectCode",
              message: "请选择业务表。",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看问题 请选择业务表。" }));

    expect(screen.getByLabelText("当前组件")).toHaveValue("本月商机");
    expect(screen.getByLabelText("业务表")).toHaveFocus();
  });
});
