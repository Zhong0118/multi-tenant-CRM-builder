import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ObjectDraft,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import type { ObjectApi } from "@/features/objects/object-api";
import type { AutomationApi } from "./automation-api";
import type { AutomationRule } from "./automation-types";
import { AutomationDesigner } from "./automation-designer";

const draft = {
  object: {
    id: "source",
    code: "customers",
    name: "客户",
    version: 1,
    status: "ACTIVE",
    publicationNumber: null,
  },
  fields: [
    {
      id: "f1",
      fieldKey: "name",
      label: "客户名称",
      type: "TEXT",
      status: "ACTIVE",
      config: {},
      required: true,
      defaultValue: null,
    },
  ],
  activeRecordCount: 0,
} as unknown as ObjectDraft;
const rule: AutomationRule = {
  key: "confirm",
  label: "确认开单",
  enabled: true,
  allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
  trigger: { type: "MANUAL" },
  targetObjectCode: "orders",
  owner: "ACTOR",
  mappings: { name: { source: "SOURCE_FIELD", fieldKey: "name" } },
};
function setup(onDirtyChange = vi.fn()) {
  const api = {
    configuration: vi.fn().mockResolvedValue({
      objectId: "source",
      version: 1,
      rules: [rule],
      publishedRules: [],
    }),
    save: vi.fn().mockImplementation(async (_tenant, _id, _version, rules) => ({
      objectId: "source",
      version: 2,
      rules,
      publishedRules: [],
    })),
    stats: vi.fn().mockResolvedValue({
      days: 30,
      timezone: "America/New_York",
      from: "2026-09-01T12:00:00.000Z",
      until: "2026-10-01T12:00:00.000Z",
      deduplicationCoverage: "SINCE_INSTRUMENTATION",
      totals: { succeeded: 2, failed: 1, deduplicated: 3 },
      items: [
        {
          ruleKey: "removed",
          ruleLabel: "历史开单规则",
          targetObjectCode: "orders",
          targetObjectName: "开单",
          triggerType: "MANUAL",
          current: false,
          enabled: false,
          succeeded: 2,
          failed: 1,
          deduplicated: 3,
          lastExecutedAt: "2026-09-30T12:00:00.000Z",
        },
      ],
    }),
    statsEvents: vi
      .fn()
      .mockImplementation(async (_tenant, _object, _rule, query) => ({
        nextCursor: query.cursor ? null : "cursor-page-2",
        until: query.until,
        pageSize: 20,
        total: 21,
        items: [
          {
            id: `event-${query.cursor ?? "first"}`,
            ruleKey: "removed",
            ruleLabel: "历史开单规则",
            status: "FAILED",
            executedAt: "2026-09-30T12:00:00.000Z",
            sourceRecordId: "source-record",
            sourceRecordNo: "LEAD-001",
            sourceAvailable: false,
            targetObjectCode: null,
            targetObjectName: null,
            targetRecordId: null,
            targetRecordNo: null,
            targetAvailable: false,
            errorCode: "FIELD_REQUIRED",
            errorMessage: "必填字段不能为空",
          },
        ],
      })),
  } as unknown as AutomationApi;
  const objects = {
    listDrafts: vi.fn().mockResolvedValue([
      {
        object: {
          id: "target",
          code: "orders",
          name: "开单",
          status: "ACTIVE",
          publicationNumber: 1,
        },
      },
    ]),
    runtimeSchema: vi.fn().mockResolvedValue({
      object: { code: "orders", name: "开单" },
      fields: [
        {
          fieldKey: "name",
          label: "客户名称",
          type: "TEXT",
          config: {},
          required: true,
          defaultValue: null,
        },
      ],
    } as unknown as RuntimeObjectSchema),
  } as unknown as ObjectApi;
  const changed = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const renderDraft = (value: ObjectDraft) => (
    <QueryClientProvider client={client}>
      <AutomationDesigner
        tenantCode="demo"
        draft={value}
        api={api}
        objects={objects}
        onObjectVersion={changed}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>
  );
  const rendered = render(renderDraft(draft));
  return {
    api,
    changed,
    rerender: (value: ObjectDraft) => rendered.rerender(renderDraft(value)),
  };
}
describe("AutomationDesigner", () => {
  it("shows historical rule statistics for archived tables and paginates filtered events without editing", async () => {
    const { api, rerender } = setup();
    rerender({ ...draft, object: { ...draft.object, status: "ARCHIVED" } });
    fireEvent.click(await screen.findByText("执行统计"));
    expect(await screen.findByText("历史开单规则")).toBeInTheDocument();
    expect(screen.getByText("2026/9/30 08:00:00")).toBeInTheDocument();
    expect(screen.getByText(/早期未记录的数据不补算/)).toBeInTheDocument();
    expect(screen.getByText("已移除")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建规则" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "查看明细 历史开单规则" }),
    );
    expect(await screen.findByText("必填字段不能为空")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "LEAD-001" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "失败" }));
    await waitFor(() =>
      expect(api.statsEvents).toHaveBeenLastCalledWith(
        "demo",
        "source",
        "removed",
        expect.objectContaining({
          days: 30,
          until: "2026-10-01T12:00:00.000Z",
          cursor: undefined,
          status: "FAILED",
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(api.statsEvents).toHaveBeenLastCalledWith(
        "demo",
        "source",
        "removed",
        expect.objectContaining({ cursor: "cursor-page-2", status: "FAILED" }),
      ),
    );
    expect(
      await screen.findByText("共 21 条 · 每页 20 条 · 第 2 页"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(
      await screen.findByText("共 21 条 · 每页 20 条 · 第 1 页"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "成功" }));
    await waitFor(() =>
      expect(api.statsEvents).toHaveBeenLastCalledWith(
        "demo",
        "source",
        "removed",
        expect.objectContaining({ cursor: undefined, status: "SUCCEEDED" }),
      ),
    );
    expect(api.save).not.toHaveBeenCalled();
  });

  it("shows statistics permission errors instead of an empty history and retries explicitly", async () => {
    const { api } = setup();
    vi.mocked(api.stats).mockRejectedValue({
      code: "OBJECT_ACTION_FORBIDDEN",
      message: "无权查看执行统计",
      fieldErrors: {},
      requestId: "test",
      status: 403,
    });
    fireEvent.click(await screen.findByText("执行统计"));
    expect(await screen.findByText("无权查看执行统计")).toBeInTheDocument();
    expect(screen.queryByText("暂无执行记录")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载统计" }));
    await waitFor(() => expect(api.stats).toHaveBeenCalledTimes(2));
  });
  it("shows draft versus published and explicitly tells admin to publish after saving", async () => {
    const { api, changed } = setup();
    await screen.findByText("有待发布的规则修改");
    fireEvent.click(screen.getByLabelText("查看规则 确认开单"));
    fireEvent.change(screen.getByLabelText("规则名称"), {
      target: { value: "确认签约" },
    });
    fireEvent.click(screen.getByText("保存规则草稿"));
    await screen.findByText("规则草稿已保存，发布业务表后生效");
    expect(api.save).toHaveBeenCalledWith("demo", "source", 1, [
      { ...rule, label: "确认签约" },
    ]);
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        object: expect.objectContaining({
          version: 2,
          hasUnpublishedChanges: true,
        }),
      }),
    );
  });
  it("does not show a draft rule as active", async () => {
    setup();
    await screen.findByText("有待发布的规则修改");
    fireEvent.click(screen.getByText("当前生效"));
    expect(
      screen.queryByLabelText("查看规则 确认开单"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("还没有生效规则，保存草稿并发布后将在这里显示"),
    ).toBeInTheDocument();
  });
});

it("refreshes live rules after publication without another draft edit", async () => {
  const { api, rerender } = setup();
  await screen.findByText("有待发布的规则修改");
  vi.mocked(api.configuration).mockResolvedValue({
    objectId: "source",
    version: 1,
    rules: [rule],
    publishedRules: [rule],
  });
  rerender({ ...draft, object: { ...draft.object, publicationNumber: 1 } });
  await screen.findByText("当前草稿与生效规则一致");
  fireEvent.click(screen.getByText("当前生效"));
  fireEvent.click(screen.getByLabelText("查看规则 确认开单"));
  expect(await screen.findByLabelText("规则名称")).toBeDisabled();
  expect(screen.queryByText("保存规则草稿")).not.toBeInTheDocument();
});

it("keeps edits when canceling the discard confirmation", async () => {
  const { api } = setup();
  fireEvent.click(await screen.findByLabelText("查看规则 确认开单"));
  fireEvent.change(screen.getByLabelText("规则名称"), {
    target: { value: "新名称" },
  });
  fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
  expect(await screen.findByText("放弃未保存的规则修改？")).toBeInTheDocument();
  fireEvent.click(screen.getByText("继续编辑"));
  expect(screen.getByLabelText("规则名称")).toHaveValue("新名称");
  expect(api.save).not.toHaveBeenCalled();
});

it("reports unsaved rule edits and clears the page guard on discard", async () => {
  const dirty = vi.fn();
  setup(dirty);
  fireEvent.click(await screen.findByLabelText("查看规则 确认开单"));
  fireEvent.change(screen.getByLabelText("规则名称"), {
    target: { value: "尚未保存的规则" },
  });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
  fireEvent.click(await screen.findByText("放弃修改"));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
