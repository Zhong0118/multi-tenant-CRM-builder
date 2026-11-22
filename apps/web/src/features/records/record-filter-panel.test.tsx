import type {
  FilterRule,
  FilterPreviewRequest,
  FilterPreview,
} from "@crm/contracts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { RecordFilterChips, RecordFilterPanel } from "./record-filter-panel";

const empty: FilterRule = { version: 1, match: "all", conditions: [] };
function field(
  fieldKey: string,
  label: string,
  type: PublishedFieldView["type"],
  extra: Partial<PublishedFieldView> = {},
): PublishedFieldView {
  return {
    id: fieldKey,
    fieldKey,
    label,
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    isSystem: false,
    sortOrder: 0,
    access: "EDIT",
    ...extra,
  };
}
const fields = [
  field("name", "客户名称", "TEXT"),
  field("amount", "预计金额", "MONEY"),
  field("signed", "签约日", "DATE"),
  field("won", "已签约", "BOOLEAN"),
  field("score", "评分", "NUMBER"),
  field("translated", "兼容日期", "TEXT", {
    config: { dateInterpretation: true },
  }),
  field("stage", "阶段", "SINGLE_SELECT", {
    config: {
      options: [
        { key: "quote", label: "报价" },
        { key: "neg", label: "谈判" },
        { key: "retired", label: "已停用", status: "INACTIVE" },
      ],
    },
  }),
  field("secret", "内部字段名", "TEXT", { access: "HIDDEN" }),
];
const members = [
  { id: "01950000-abcd-7000-a000-000000000001", displayName: "陈林" },
];

function mount(
  initial: FilterRule = empty,
  isAdmin = false,
  onPreview = vi.fn<
    (
      request: FilterPreviewRequest,
      signal: AbortSignal,
    ) => Promise<FilterPreview>
  >(),
) {
  const applied = vi.fn();
  function Host() {
    const [rule, setRule] = useState(initial);
    const [editIndex, onEditIndex] = useState<number | null>(null);
    const props = {
      schema: { fields },
      onPreview,
      members,
      rule,
      onApply(next: FilterRule) {
        applied(next);
        setRule(next);
      },
      isAdmin,
      editIndex,
      onEditIndex,
    };
    return (
      <>
        <RecordFilterPanel {...props} />
        <RecordFilterChips {...props} />
      </>
    );
  }
  render(<Host />);
  return applied;
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: /^筛选(?:\s*\d+)?$/ }));
}
function add() {
  fireEvent.click(screen.getByText("添加条件"));
}
function apply() {
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
}
function toggleOption(control: string, label: string) {
  fireEvent.mouseDown(screen.getByLabelText(control));
  const option = screen.getByRole("option", { name: label });
  fireEvent.click(option);
  fireEvent.keyDown(screen.getByLabelText(control), { key: "Escape" });
}

describe("record filter editor and condition summary", () => {
  it("applies any with exact money and active select options, opens a chip at its row, and discards canceled edits", async () => {
    const save = mount();
    open();
    change("匹配方式", "any");
    add();
    change("条件 1 字段", "amount");
    change("条件 1 比较方式", "gt");
    change("条件 1 值", "100000.00000000000001");
    add();
    change("条件 2 字段", "stage");
    toggleOption("条件 2 值", "报价");
    toggleOption("条件 2 值", "谈判");
    expect(screen.queryByRole("option", { name: "已停用" })).toBeNull();
    apply();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        version: 1,
        match: "any",
        conditions: [
          {
            fieldKey: "amount",
            operator: "gt",
            value: "100000.00000000000001",
          },
          { fieldKey: "stage", operator: "in", value: ["quote", "neg"] },
        ],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /编辑 阶段.*报价.*谈判/ }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("条件 2 字段")).toHaveFocus(),
    );
    change("条件 2 字段", "signed");
    expect(screen.getByLabelText("条件 2 值")).toHaveValue("");
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /编辑 阶段.*报价.*谈判/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("移除条件 阶段"));
    expect(save.mock.lastCall?.[0].conditions).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("移除条件 预计金额"));
    expect(save.mock.lastCall?.[0]).toEqual(empty);
  });

  it("supports dates, relative presets, zero, false and value-free presence", () => {
    const save = mount();
    open();
    add();
    change("条件 1 字段", "signed");
    change("条件 1 比较方式", "between");
    change("条件 1 起始值", "2026-11-26");
    change("条件 1 结束值", "2026-11-25");
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    change("条件 1 结束值", "2026-11-26");
    add();
    change("条件 2 字段", "signed");
    change("条件 2 比较方式", "relative");
    change("条件 2 值", "past_7_days");
    add();
    change("条件 3 字段", "score");
    change("条件 3 值", "0");
    add();
    change("条件 4 字段", "won");
    change("条件 4 值", "false");
    add();
    change("条件 5 值", "不会保存");
    change("条件 5 比较方式", "empty");
    expect(screen.queryByLabelText("条件 5 值")).toBeNull();
    apply();
    expect(save.mock.lastCall?.[0].conditions).toEqual([
      {
        fieldKey: "signed",
        operator: "between",
        value: { from: "2026-11-26", to: "2026-11-26" },
      },
      { fieldKey: "signed", operator: "relative", value: "past_7_days" },
      { fieldKey: "score", operator: "eq", value: 0 },
      { fieldKey: "won", operator: "eq", value: false },
      { fieldKey: "name", operator: "empty" },
    ]);
  });

  it.each([true, false])(
    "offers the signed-in member and role-appropriate follow-up scope (admin %s)",
    (isAdmin) => {
      const save = mount(empty, isAdmin);
      open();
      add();
      change("条件 1 字段", "$owner");
      toggleOption("条件 1 值", "我");
      add();
      change("条件 2 字段", "$followUp");
      if (isAdmin) change("条件 2 值", "any");
      else
        expect(
          within(screen.getByLabelText("条件 2 值")).queryByText("任何人"),
        ).toBeNull();
      apply();
      const result = save.mock.lastCall?.[0] as FilterRule;
      expect(result.conditions[0]).toEqual({
        fieldKey: "$owner",
        operator: "in",
        value: ["$me"],
      });
      expect(result.conditions[1]).toEqual({
        fieldKey: "$followUp",
        operator: "dueThroughToday",
        value: { assignee: isAdmin ? "any" : "$me" },
      });
    },
  );

  it("shows a nested group and retains its complete tree when adding a top-level condition", () => {
    const group = {
      match: "any" as const,
      conditions: [
        { fieldKey: "stage", operator: "in" as const, value: ["quote", "neg"] },
        { fieldKey: "won", operator: "eq" as const, value: false },
      ],
    };
    const save = mount({ ...empty, conditions: [group] });
    expect(
      screen.getByRole("button", { name: /编辑 .*任一.*报价.*谈判.*已签约/ }),
    ).toBeInTheDocument();
    open();
    expect(screen.queryByLabelText("条件 1 字段")).toBeNull();
    add();
    change("条件 2 比较方式", "notEmpty");
    apply();
    expect(save.mock.lastCall?.[0].conditions).toEqual([
      group,
      { fieldKey: "name", operator: "notEmpty" },
    ]);
  });

  it("omits hidden metadata from chips and selectors, and bounds the number of terms", () => {
    const save = mount({
      ...empty,
      conditions: [
        { fieldKey: "secret", operator: "contains", value: "不可见秘密" },
        ...Array.from({ length: 15 }, () => ({
          fieldKey: "name",
          operator: "notEmpty" as const,
        })),
      ],
    });
    open();
    expect(screen.getByText("添加条件").closest("button")).toBeDisabled();
    expect(screen.queryByText("内部字段名")).toBeNull();
    expect(screen.queryByText(/不可见秘密/)).toBeNull();
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});

it("offers both textual and calendar operations on interpreted date text", () => {
  mount();
  open();
  add();
  change("条件 1 字段", "translated");
  const ops = screen.getByLabelText("条件 1 比较方式");
  expect(within(ops).getByRole("option", { name: "包含" })).toBeInTheDocument();
  fireEvent.change(ops, { target: { value: "on" } });
  expect(screen.getByLabelText("条件 1 值")).toHaveAttribute("type", "date");
  change("条件 1 比较方式", "relative");
  const values = screen.getByLabelText("条件 1 值");
  expect(
    within(values).getByRole("option", { name: "昨天" }),
  ).toBeInTheDocument();
  expect(
    within(values).getByRole("option", { name: "上月" }),
  ).toBeInTheDocument();
});

describe("natural-language filter previews", () => {
  const initial: FilterRule = {
    ...empty,
    conditions: [
      { fieldKey: "amount", operator: "gt", value: "100.00" },
      { fieldKey: "stage", operator: "in", value: ["neg", "quote"] },
    ],
  };
  const next: FilterRule = {
    ...empty,
    match: "any",
    conditions: [
      { fieldKey: "stage", operator: "in", value: ["quote", "neg"] },
      { fieldKey: "won", operator: "eq", value: true },
    ],
  };
  const previewMock = () =>
    vi.fn<
      (
        request: FilterPreviewRequest,
        signal: AbortSignal,
      ) => Promise<FilterPreview>
    >();
  function generate(text = "换成已签约或谈判中的客户") {
    change("用一句话描述条件", text);
    fireEvent.click(screen.getByRole("button", { name: "生成条件" }));
  }

  it("compares against the manual draft, restores it on undo, and applies only after edits", async () => {
    const preview = previewMock().mockResolvedValue({
      kind: "rule",
      rule: next,
    });
    const save = mount(initial, false, preview);
    open();
    change("条件 1 值", "105.00");
    generate();
    await screen.findByText("已生成 · 尚未应用");
    expect(preview.mock.calls[0][0].currentRule.conditions[0]).toMatchObject({
      value: "105.00",
    });
    expect(screen.getAllByText("新")).toHaveLength(1);
    expect(screen.getByText(/预计金额.*105.00/)).toBeInTheDocument();
    expect(screen.getByLabelText("匹配方式")).toHaveValue("any");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤销生成" }));
    expect(screen.getByLabelText("条件 1 值")).toHaveValue("105.00");
    expect(screen.queryByText("将移除")).toBeNull();
    generate();
    await screen.findByText("已生成 · 尚未应用");
    change("条件 2 值", "false");
    expect(screen.getByText("已编辑 · 尚未应用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用并替换条件" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].conditions[1]).toMatchObject({ value: false });
  });

  it("retains the input on failure and selects a complete clarification without another request", async () => {
    const preview = previewMock()
      .mockRejectedValueOnce(new Error("internal"))
      .mockResolvedValue({
        kind: "clarify",
        options: [
          { id: "one", label: "阶段为报价或谈判", value: initial },
          { id: "two", label: "阶段或已签约", value: next },
        ],
      });
    const save = mount(empty, false, preview);
    open();
    generate("重点客户");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请调整描述或手动筛选",
    );
    expect(screen.getByLabelText("用一句话描述条件")).toHaveValue("重点客户");
    fireEvent.click(screen.getByRole("button", { name: "生成条件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "阶段或已签约" }),
    );
    expect(screen.getByLabelText("条件 2 字段")).toHaveValue("won");
    expect(preview).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(save).not.toHaveBeenCalled();
  });

  it("discards delayed results after a manual edit and after closing the editor", async () => {
    const outstanding: ((result: FilterPreview) => void)[] = [];
    const preview = previewMock().mockImplementation(
      () => new Promise((resolve) => outstanding.push(resolve)),
    );
    mount(initial, false, preview);
    open();
    generate();
    change("条件 1 值", "150");
    expect(preview.mock.calls[0][1].aborted).toBe(true);
    await act(async () => outstanding[0]({ kind: "rule", rule: next }));
    expect(screen.getByLabelText("条件 1 值")).toHaveValue("150");
    generate();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(preview.mock.calls[1][1].aborted).toBe(true));
    open();
    await act(async () => outstanding[1]({ kind: "rule", rule: next }));
    expect(screen.getByLabelText("条件 1 值")).toHaveValue("100.00");
    expect(screen.queryByText("已生成 · 尚未应用")).toBeNull();
  });
});
