import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  previewDashboardDraft,
  publishDashboardDraft,
  saveDashboardDraft,
} from "./dashboard-api";
import { DashboardBuilder } from "./dashboard-builder";
import {
  parseDashboardFilter,
  type DashboardConfigurationView,
  type DashboardWidgetDraft,
} from "./dashboard-types";

vi.mock("./dashboard-api", () => ({
  saveDashboardDraft: vi.fn(),
  previewDashboardDraft: vi.fn(),
  publishDashboardDraft: vi.fn(),
}));

const initial = {
  timezone: "Asia/Shanghai",
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
          fieldKey: "stage",
          label: "阶段",
          type: "SINGLE_SELECT",
          config: {
            options: [
              { key: "open", label: "跟进中", color: "BLUE", status: "ACTIVE" },
              { key: "won", label: "已赢单", color: "GREEN", status: "ACTIVE" },
            ],
          },
        },
        {
          fieldKey: "amount",
          label: "金额",
          type: "MONEY",
          config: {},
        },
        {
          fieldKey: "closedAt",
          label: "预计成交日",
          type: "DATE",
          config: {},
        },
        {
          fieldKey: "signedAt",
          label: "签约时间",
          type: "DATETIME",
          config: {},
        },
        {
          fieldKey: "title",
          label: "标题",
          type: "TEXT",
          config: {},
        },
      ],
    },
  ],
  issues: [],
} satisfies DashboardConfigurationView;

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

  it("publishes an existing saved draft after reload and disables publishing only while dirty", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    expect(screen.getByRole("button", { name: "发布工作台" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    expect(screen.getByRole("button", { name: "发布工作台" })).toBeDisabled();
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

  it("never duplicates component IDs after delete-then-add", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "删除组件 指标卡 1" }));
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(saveDashboardDraft).toHaveBeenCalled());
    const saved = vi
      .mocked(saveDashboardDraft)
      .mock.calls.at(-1)?.[1].configuration;
    const ids = saved?.widgets.map((widget) => widget.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never duplicates a copied component ID when count-based IDs already have gaps", async () => {
    const widgets = [
      {
        id: "metric-1",
        type: "METRIC" as const,
        title: "指标卡 1",
        audience: "ALL" as const,
        objectCode: "deals",
        width: "QUARTER" as const,
        sortOrder: 1,
        filters: [],
        aggregation: "COUNT" as const,
        displayFormat: "NUMBER" as const,
      },
      {
        id: "metric-3",
        type: "METRIC" as const,
        title: "指标卡 3",
        audience: "ALL" as const,
        objectCode: "deals",
        width: "QUARTER" as const,
        sortOrder: 2,
        filters: [],
        aggregation: "COUNT" as const,
        displayFormat: "NUMBER" as const,
      },
    ];
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={{
          ...initial,
          draft: {
            ...initial.draft,
            draftConfiguration: {
              ...initial.draft.draftConfiguration,
              widgets,
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制组件 指标卡 1" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(saveDashboardDraft).toHaveBeenCalled());
    const saved = vi
      .mocked(saveDashboardDraft)
      .mock.calls.at(-1)?.[1].configuration;
    const ids = saved?.widgets.map((widget) => widget.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("updates the active publication indicator immediately after publishing", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    expect(screen.getByText("线上第 3 版")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布工作台" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "发布工作台" }));

    expect(await screen.findByText("线上第 4 版")).toBeInTheDocument();
    expect(screen.queryByText("线上第 3 版")).not.toBeInTheDocument();
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

    fireEvent.click(
      screen.getByRole("button", { name: "查看问题 请选择业务表。" }),
    );

    expect(screen.getByLabelText("当前组件")).toHaveValue("本月商机");
    expect(screen.getByLabelText("业务表")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("业务表"), {
      target: { value: "deals" },
    });
    expect(
      screen.getByRole("button", { name: "查看问题 请选择业务表。" }),
    ).toHaveTextContent("上次校验");
  });

  it("retains another component's last-validation issue across width and title edits", () => {
    const first = metricWidget("metric-first", "第一个指标", 1);
    const second = metricWidget("metric-second", "第二个指标", 2);
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets(
          [first, second],
          [
            {
              code: "DASHBOARD_OBJECT_REQUIRED",
              path: "widgets[1].objectCode",
              message: "第二个组件仍需选择业务表。",
            },
          ],
        )}
      />,
    );

    fireEvent.click(screen.getByRole("article", { name: "第一个指标 组件" }));
    fireEvent.change(screen.getByLabelText("组件标题"), {
      target: { value: "修改后的第一个指标" },
    });
    fireEvent.change(screen.getByLabelText("组件宽度 修改后的第一个指标"), {
      target: { value: "FULL" },
    });

    expect(
      screen.getByRole("button", {
        name: "查看问题 第二个组件仍需选择业务表。",
      }),
    ).toHaveTextContent("上次校验");
  });

  it("keeps an issue attached to the same component after reorder", () => {
    const first = metricWidget("metric-first", "第一个指标", 1);
    const second = metricWidget("metric-second", "第二个指标", 2);
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets(
          [first, second],
          [
            {
              code: "DASHBOARD_OBJECT_REQUIRED",
              path: "widgets[0].objectCode",
              message: "第一个组件需重新选择业务表。",
            },
          ],
        )}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "下移组件 第一个指标" }),
    );

    const firstCard = screen.getByRole("article", { name: "第一个指标 组件" });
    expect(
      within(firstCard).getByRole("button", {
        name: "查看问题 第一个组件需重新选择业务表。",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(firstCard).getByRole("button", {
        name: "查看问题 第一个组件需重新选择业务表。",
      }),
    );
    expect(screen.getByLabelText("当前组件")).toHaveValue("第一个指标");
    expect(screen.getByLabelText("业务表")).toHaveFocus();
  });

  it("deletes only the removed component's issues", () => {
    const first = metricWidget("metric-first", "第一个指标", 1);
    const second = metricWidget("metric-second", "第二个指标", 2);
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets(
          [first, second],
          [
            {
              code: "FIRST_ISSUE",
              path: "widgets[0].objectCode",
              message: "删除时一起移除的问题。",
            },
            {
              code: "SECOND_ISSUE",
              path: "widgets[1].objectCode",
              message: "另一个组件的问题必须保留。",
            },
          ],
        )}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "删除组件 第一个指标" }),
    );

    expect(
      screen.queryByRole("button", { name: "查看问题 删除时一起移除的问题。" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "查看问题 另一个组件的问题必须保留。",
      }),
    ).toBeInTheDocument();
  });

  it("clears last-validation issues only after a successful preview", async () => {
    const widget = metricWidget("metric-first", "第一个指标", 1);
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets(
          [widget],
          [
            {
              code: "OLD_ISSUE",
              path: "widgets[0].objectCode",
              message: "上次校验的问题。",
            },
          ],
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));

    expect(
      await screen.findByText("已按保存的草稿生成预览。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "查看问题 上次校验的问题。" }),
    ).not.toBeInTheDocument();
  });

  it("shows publish field errors inline, focuses the first blocking control, and clears them on success", async () => {
    const widget = {
      id: "metric-existing",
      type: "METRIC" as const,
      title: "本月商机",
      audience: "ALL" as const,
      objectCode: "deals",
      width: "QUARTER" as const,
      sortOrder: 1,
      filters: [],
      aggregation: "COUNT" as const,
      displayFormat: "NUMBER" as const,
    };
    vi.mocked(publishDashboardDraft)
      .mockRejectedValueOnce({
        code: "VALIDATION_FAILED",
        message: "请修复配置",
        requestId: "request-publish",
        status: 400,
        fieldErrors: { "widgets[0].objectCode": ["请选择可用的业务表。"] },
      })
      .mockResolvedValueOnce({
        id: "publication-4",
        number: 4,
        sourceDraftVersion: 4,
        publishedAt: "2026-09-01T02:00:00.000Z",
      });
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={{
          ...initial,
          draft: {
            ...initial.draft,
            draftConfiguration: {
              ...initial.draft.draftConfiguration,
              widgets: [widget],
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发布工作台" }));
    expect(
      await screen.findByRole("button", {
        name: "查看问题 请选择可用的业务表。",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("当前组件")).toHaveValue("本月商机");
    expect(screen.getByLabelText("业务表")).toHaveFocus();

    const publishButton = screen.getByText("发布工作台").closest("button");
    await waitFor(() => expect(publishButton).toBeEnabled());
    fireEvent.click(publishButton!);
    expect(
      await screen.findByText("工作台已发布为第 4 版。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "查看问题 请选择可用的业务表。",
      }),
    ).not.toBeInTheDocument();
  });

  it("saves a newly added record list before display fields are selected", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "添加记录列表" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(saveDashboardDraft).toHaveBeenCalledWith(
        "northwind",
        expect.objectContaining({
          configuration: expect.objectContaining({
            widgets: [expect.objectContaining({ fieldKeys: [] })],
          }),
        }),
      ),
    );
  });

  it("edits the representative V2 controls, filters, width and keyboard reorder", () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    expect(screen.getByLabelText("显示格式")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加状态分布" }));
    fireEvent.change(screen.getByLabelText("业务表"), {
      target: { value: "deals" },
    });
    expect(screen.getByLabelText("分组选项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加筛选条件" }));
    expect(screen.getByLabelText("筛选字段 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加趋势图" }));
    expect(screen.getByLabelText("时间粒度")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加员工业绩排行" }));
    expect(screen.getByLabelText("成员来源")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加记录列表" }));
    expect(screen.getByLabelText("排序字段")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "下移组件 记录列表 1" }),
    ).toBeDisabled();
  });

  it("serializes each operator-specific filter value shape", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.change(screen.getByLabelText("业务表"), {
      target: { value: "deals" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加筛选条件" }));
    fireEvent.change(screen.getByLabelText("筛选字段 1"), {
      target: { value: "stage" },
    });
    const stageOptions = screen.getByLabelText("筛选值 1") as HTMLSelectElement;
    stageOptions.options[0].selected = true;
    stageOptions.options[1].selected = true;
    fireEvent.change(stageOptions);

    fireEvent.click(screen.getByRole("button", { name: "添加筛选条件" }));
    fireEvent.change(screen.getByLabelText("筛选字段 2"), {
      target: { value: "amount" },
    });
    fireEvent.change(screen.getByLabelText("筛选操作符 2"), {
      target: { value: "BETWEEN" },
    });
    fireEvent.change(screen.getByLabelText("筛选值 2 起"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("筛选值 2 止"), {
      target: { value: "20" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加筛选条件" }));
    fireEvent.change(screen.getByLabelText("筛选字段 3"), {
      target: { value: "closedAt" },
    });
    fireEvent.change(screen.getByLabelText("筛选操作符 3"), {
      target: { value: "PAST_N_DAYS" },
    });
    fireEvent.change(screen.getByLabelText("筛选值 3"), {
      target: { value: "14" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加筛选条件" }));
    fireEvent.change(screen.getByLabelText("筛选字段 4"), {
      target: { value: "title" },
    });
    fireEvent.change(screen.getByLabelText("筛选操作符 4"), {
      target: { value: "NOT_EMPTY" },
    });
    expect(screen.queryByLabelText("筛选值 4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(saveDashboardDraft).toHaveBeenCalledWith(
        "northwind",
        expect.objectContaining({
          configuration: expect.objectContaining({
            widgets: [
              expect.objectContaining({
                filters: [
                  { fieldKey: "stage", operator: "IN", value: ["open", "won"] },
                  { fieldKey: "amount", operator: "BETWEEN", value: [10, 20] },
                  { fieldKey: "closedAt", operator: "PAST_N_DAYS", value: 14 },
                  { fieldKey: "title", operator: "NOT_EMPTY" },
                ],
              }),
            ],
          }),
        }),
      ),
    );
  });

  it("round-trips DATETIME filters through the persisted tenant timezone", async () => {
    const widget = {
      ...metricWidget("metric-datetime", "签约指标", 1),
      filters: [
        {
          fieldKey: "signedAt",
          operator: "BETWEEN" as const,
          value: ["2026-09-01T00:30:15.250Z", "2026-09-01T01:30:15.250Z"] as [
            string,
            string,
          ],
        },
      ],
    };
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets([widget], [])}
      />,
    );

    expect(screen.getByText("租户时区：Asia/Shanghai")).toBeInTheDocument();
    expect(screen.getByLabelText("筛选值 1 起")).toHaveValue(
      "2026-09-01T08:30:15.250",
    );
    fireEvent.change(screen.getByLabelText("筛选值 1 起"), {
      target: { value: "2026-09-01T09:15:00.000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(saveDashboardDraft).toHaveBeenCalledWith(
        "northwind",
        expect.objectContaining({
          configuration: expect.objectContaining({
            widgets: [
              expect.objectContaining({
                filters: [
                  expect.objectContaining({
                    value: [
                      "2026-09-01T01:15:00.000Z",
                      "2026-09-01T01:30:15.250Z",
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      ),
    );
  });

  it("reports catalog drift without blaming the canvas", async () => {
    vi.mocked(publishDashboardDraft).mockRejectedValue({
      code: "DASHBOARD_CATALOG_CHANGED",
      message: "业务表配置已更新",
      requestId: "request-catalog",
      status: 409,
      fieldErrors: {},
    });
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "发布工作台" }));

    expect(
      await screen.findByText(
        "业务表配置已更新；请重新载入页面、预览草稿后再发布。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/修复画布/)).not.toBeInTheDocument();
  });

  it("preserves local content and reports the server version on publish conflict", async () => {
    vi.mocked(publishDashboardDraft).mockRejectedValue({
      code: "DASHBOARD_DRAFT_VERSION_CONFLICT",
      message: "草稿版本冲突",
      requestId: "request-conflict",
      status: 409,
      fieldErrors: { currentVersion: ["7"] },
    });
    const widget = metricWidget("metric-local", "本地保留的指标", 1);
    render(
      <DashboardBuilder
        tenantCode="northwind"
        initial={withWidgets([widget], [])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发布工作台" }));

    expect(
      await screen.findByText(
        "草稿版本已变化；本地内容已保留，请重新载入页面后合并并重新预览。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("服务器草稿版本为 7")).toBeInTheDocument();
    expect(screen.getAllByText("本地保留的指标")).not.toHaveLength(0);
  });

  it("rejects malformed filter values at the browser boundary", () => {
    expect(() =>
      parseDashboardFilter({
        fieldKey: "stage",
        operator: "IN",
        value: "open",
      }),
    ).toThrow("Invalid dashboard response");
    expect(() =>
      parseDashboardFilter({
        fieldKey: "closedAt",
        operator: "TODAY",
        value: 1,
      }),
    ).toThrow("Invalid dashboard response");
  });

  it("reports a non-conflict save failure without inventing a server version", async () => {
    vi.mocked(saveDashboardDraft).mockRejectedValue({
      code: "DASHBOARD_CONFIGURATION_INVALID",
      message: "请修复配置",
      requestId: "request-2",
      status: 422,
      fieldErrors: {},
    });
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(
      await screen.findByText("保存草稿失败：请修复配置"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/服务器草稿版本/)).not.toBeInTheDocument();
  });

  it("clears a metric value field when its object changes", async () => {
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.change(screen.getByLabelText("业务表"), {
      target: { value: "deals" },
    });
    fireEvent.change(screen.getByLabelText("聚合方式"), {
      target: { value: "SUM" },
    });
    fireEvent.change(screen.getByLabelText("数值字段"), {
      target: { value: "amount" },
    });
    fireEvent.change(screen.getByLabelText("业务表"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(saveDashboardDraft).toHaveBeenCalledWith(
        "northwind",
        expect.objectContaining({
          configuration: expect.objectContaining({
            widgets: [
              expect.not.objectContaining({ valueFieldKey: expect.anything() }),
            ],
          }),
        }),
      ),
    );
  });

  it("keeps a dirty editor on the page when a same-origin link is cancelled", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/workspace/northwind";
    document.body.append(link);
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);

    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.change(screen.getByLabelText("组件标题"), {
      target: { value: "修改后的标题" },
    });
    expect(
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();

    link.remove();
    confirm.mockRestore();
  });

  it("renders server preview output and keeps a conflict draft with its current version", async () => {
    vi.mocked(previewDashboardDraft).mockResolvedValue({
      title: "销售工作台",
      period: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      widgets: [
        {
          id: "metric-1",
          type: "METRIC",
          title: "真实总数",
          width: "QUARTER",
          sortOrder: 1,
          state: "READY",
          data: { value: 12, format: "NUMBER" },
        },
      ],
    } as never);
    vi.mocked(saveDashboardDraft).mockRejectedValue({
      code: "DASHBOARD_DRAFT_VERSION_CONFLICT",
      message: "Draft version conflict",
      requestId: "request-1",
      status: 409,
      fieldErrors: { currentVersion: ["7"] },
    });
    render(<DashboardBuilder tenantCode="northwind" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "预览草稿" }));
    expect(await screen.findByText("真实总数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加指标卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText("服务器草稿版本为 7")).toBeInTheDocument();
  });
});

function metricWidget(id: string, title: string, sortOrder: number) {
  return {
    id,
    type: "METRIC" as const,
    title,
    audience: "ALL" as const,
    objectCode: "deals",
    width: "QUARTER" as const,
    sortOrder,
    filters: [],
    aggregation: "COUNT" as const,
    displayFormat: "NUMBER" as const,
  };
}

function withWidgets(
  widgets: DashboardWidgetDraft[],
  issues: DashboardConfigurationView["issues"],
): DashboardConfigurationView {
  return {
    ...initial,
    draft: {
      ...initial.draft,
      draftConfiguration: {
        ...initial.draft.draftConfiguration,
        widgets,
      },
    },
    issues,
  };
}
