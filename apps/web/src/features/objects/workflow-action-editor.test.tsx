import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  WorkflowActionEditor,
  actionFieldErrors,
  actionTargetObjects,
  type ActionFieldPathError,
  type ActionTargetField,
  type ActionTargetObject,
} from "./workflow-action-editor";
import type { ObjectDraft, PublishedFieldType } from "./object-types";
import type { WorkflowActionDraft } from "./workflow-types";

/**
 * The editor is driven the way an administrator drives it. Every assertion is
 * on the payload handed back through `onChange` — i.e. exactly what
 * `workflowApi.saveDraft()` would send — never on component state.
 */
const SOURCE_FIELDS: ActionTargetField[] = [
  { fieldKey: "company_name", label: "公司名称", type: "TEXT" },
  { fieldKey: "phone", label: "手机", type: "PHONE" },
  { fieldKey: "amount", label: "预计金额", type: "MONEY" },
  { fieldKey: "signed_on", label: "签约日", type: "DATE" },
  { fieldKey: "note", label: "备注", type: "TEXTAREA" },
  { fieldKey: "owner_member", label: "负责人成员", type: "MEMBER" },
];

const TARGET_OBJECTS: ActionTargetObject[] = [
  {
    code: "customer",
    name: "客户",
    fields: [
      { fieldKey: "name", label: "客户名称", type: "TEXT" },
      { fieldKey: "phone", label: "手机", type: "PHONE" },
      { fieldKey: "owner", label: "负责人", type: "MEMBER" },
    ],
  },
  {
    code: "work-order",
    name: "工单",
    fields: [{ fieldKey: "subject", label: "主题", type: "TEXT" }],
  },
  {
    code: "contract",
    name: "合同",
    fields: [
      { fieldKey: "signed_on", label: "签订日期", type: "DATE" },
      { fieldKey: "amount", label: "金额", type: "MONEY" },
    ],
  },
];

const NON_TEMPORAL_SOURCES = [
  "固定值",
  "当前记录字段",
  "当前记录属性",
  "执行人",
  "前序动作输出",
];

const TEMPORAL_SOURCES = ["当前时间", "当前时间加天数", "固定时间"];

/**
 * The editor labels every control uniquely and derives its DOM id from that
 * name, so a dropdown is read through the `aria-controls` listbox the open
 * combobox points at. A closed dropdown stays mounted in jsdom, so querying
 * "the visible dropdown" would otherwise read a stale one.
 */
function dropdownFor(label: string): Element | null {
  const combobox = screen.getByLabelText(label);
  const listId = combobox.getAttribute("aria-controls");
  const list = listId === null ? null : document.getElementById(listId);
  return list?.closest(".ant-select-dropdown") ?? null;
}

function openOptions(label: string): string[] {
  fireEvent.mouseDown(screen.getByLabelText(label));
  return Array.from(
    dropdownFor(label)?.querySelectorAll(".ant-select-item-option") ?? [],
  ).map((option) => option.getAttribute("title") ?? "");
}

function pick(label: string, option: string): void {
  fireEvent.mouseDown(screen.getByLabelText(label));
  const item = dropdownFor(label)?.querySelector(
    `.ant-select-item-option[title="${option}"]`,
  );
  if (!item) {
    throw new Error(`「${label}」没有可选项「${option}」`);
  }
  fireEvent.click(item);
}

interface HarnessProps {
  initial: WorkflowActionDraft[];
  errors?: ActionFieldPathError[];
  sourceFields: ActionTargetField[];
  onState: (actions: WorkflowActionDraft[]) => void;
}

function Harness({ initial, errors, sourceFields, onState }: HarnessProps) {
  const [actions, setActions] = useState(initial);
  return (
    <WorkflowActionEditor
      transitionIndex={0}
      actions={actions}
      errors={errors}
      sourceFields={sourceFields}
      targetObjects={TARGET_OBJECTS}
      onChange={(next) => {
        setActions(next);
        onState(next);
      }}
    />
  );
}

function renderEditor(
  initial: WorkflowActionDraft[] = [],
  errors?: ActionFieldPathError[],
  sourceFields: ActionTargetField[] = SOURCE_FIELDS,
) {
  const captured: { actions: WorkflowActionDraft[] } = { actions: initial };
  render(
    <Harness
      initial={initial}
      errors={errors}
      sourceFields={sourceFields}
      onState={(next) => (captured.actions = next)}
    />,
  );
  return () => captured.actions;
}

/** The Ant Design status class a control carries, read without a named query. */
function statusClassOf(label: string): string {
  return screen.getByLabelText(label).closest(".ant-select")?.className ?? "";
}

function assignOwner(key: string): WorkflowActionDraft {
  return {
    key,
    type: "ASSIGN_OWNER",
    target: "SOURCE_RECORD",
    owner: { source: "ACTOR" },
  };
}

/**
 * The `values[fieldKey]` value source of one step, narrowed without a cast so
 * the assertion itself fails if the step is not the type it claims to be.
 */
function mappingSource(
  actions: WorkflowActionDraft[],
  index: number,
  fieldKey: string,
): Record<string, unknown> {
  const action = actions[index];
  if (action?.type !== "CREATE_RECORD" && action?.type !== "UPDATE_RECORD") {
    throw new Error(`步骤 ${index + 1} 不是字段映射动作`);
  }
  const source = action.values[fieldKey];
  if (source === undefined) throw new Error(`步骤 ${index + 1} 没有映射「${fieldKey}」`);
  return source;
}

describe("actionTargetObjects", () => {
  function draft(
    id: string,
    code: string,
    status: "DRAFT" | "ACTIVE" | "ARCHIVED",
    publicationNumber: number | null,
    fields: ObjectDraft["fields"],
  ): ObjectDraft {
    return {
      object: {
        id,
        code,
        name: code,
        description: null,
        titleFieldKey: "name",
        icon: null,
        sortOrder: 10,
        version: 1,
        status,
        publicationNumber,
        publishedAt: publicationNumber === null ? null : "2026-08-20T00:00:00.000Z",
        hasUnpublishedChanges: false,
        updatedAt: null,
      },
      fields,
      defaultView: null,
      employeeAccess: null,
      activeRecordCount: 0,
    } as ObjectDraft;
  }

  function field(
    fieldKey: string,
    type: PublishedFieldType,
    publishedType: PublishedFieldType | null,
    status: "ACTIVE" | "INACTIVE" = "ACTIVE",
  ): ObjectDraft["fields"][number] {
    return {
      id: `field-${fieldKey}`,
      fieldKey,
      label: fieldKey,
      type,
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 1,
      isSystem: false,
      status,
      publishedType,
      employeeAccess: "EDIT",
    } as ObjectDraft["fields"][number];
  }

  it("offers only ACTIVE, published objects plus the object being edited", () => {
    const current = draft("object-1", "customers", "ACTIVE", 3, [
      field("company_name", "TEXT", "TEXT"),
      field("note", "TEXTAREA", null),
      field("retired", "TEXT", "TEXT", "INACTIVE"),
    ]);
    const objects = [
      current,
      draft("object-2", "customer", "ACTIVE", 1, [
        field("name", "TEXT", "TEXT"),
        field("draft_only", "TEXT", null),
      ]),
      draft("object-3", "unpublished", "ACTIVE", null, [field("name", "TEXT", "TEXT")]),
      draft("object-4", "archived", "ARCHIVED", 2, [field("name", "TEXT", "TEXT")]),
    ];

    expect(actionTargetObjects(objects, current)).toEqual([
      {
        code: "customers",
        name: "customers",
        // The pending publication freezes this draft's own ACTIVE fields, so a
        // field that has never been published is still writable here.
        fields: [
          { fieldKey: "company_name", label: "company_name", type: "TEXT" },
          { fieldKey: "note", label: "note", type: "TEXTAREA" },
        ],
      },
      {
        code: "customer",
        name: "customer",
        // Only fields that exist in the target's live publication.
        fields: [{ fieldKey: "name", label: "name", type: "TEXT" }],
      },
    ]);
  });
});

describe("WorkflowActionEditor", () => {
  it("adds a numbered step, edits its key and replaces the payload when the type changes", () => {
    const actions = renderEditor();

    fireEvent.click(screen.getByText("添加执行动作"));

    expect(actions()).toEqual([
      {
        key: "action-1",
        type: "CREATE_RECORD",
        targetObjectCode: "",
        values: {},
      },
    ]);
    expect(screen.getByText("步骤 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("执行动作编码 1-1"), {
      target: { value: "create-customer" },
    });
    expect(actions()[0]?.key).toBe("create-customer");

    pick("执行动作类型 1-1", "建立记录关联");

    // The type change replaces the payload of the previous type: neither
    // `targetObjectCode` nor `values` survives.
    expect(actions()).toEqual([
      {
        key: "create-customer",
        type: "CREATE_RELATION",
        left: { source: "SOURCE_RECORD" },
        right: { source: "SOURCE_RECORD" },
      },
    ]);
  });

  it("numbers a new step without repeating an existing key", () => {
    const actions = renderEditor([
      {
        key: "action-1",
        type: "UPDATE_RECORD",
        target: "SOURCE_RECORD",
        values: {},
      },
    ]);

    fireEvent.click(screen.getByText("添加执行动作"));

    expect(actions().map((action) => action.key)).toEqual([
      "action-1",
      "action-2",
    ]);
    expect(screen.getByText("步骤 2")).toBeInTheDocument();
  });

  it("moves a step up and down and deletes it", () => {
    const actions = renderEditor([assignOwner("first"), assignOwner("second")]);

    fireEvent.click(screen.getByLabelText("上移步骤 1-2"));
    expect(actions().map((action) => action.key)).toEqual(["second", "first"]);

    fireEvent.click(screen.getByLabelText("下移步骤 1-1"));
    expect(actions().map((action) => action.key)).toEqual(["first", "second"]);

    fireEvent.click(screen.getByLabelText("删除步骤 1-1"));
    expect(actions().map((action) => action.key)).toEqual(["second"]);
  });

  it("disables 上移 on the first step and 下移 on the last", () => {
    renderEditor([assignOwner("first"), assignOwner("second")]);

    expect(screen.getByLabelText("上移步骤 1-1")).toBeDisabled();
    expect(screen.getByLabelText("下移步骤 1-1")).not.toBeDisabled();
    expect(screen.getByLabelText("下移步骤 1-2")).toBeDisabled();
  });

  it("offers only the chosen target object's fields and edits a CREATE_RECORD mapping", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
    ]);

    expect(openOptions("添加字段映射 1-1")).toEqual([
      "客户名称",
      "手机",
      "负责人",
    ]);

    pick("添加字段映射 1-1", "手机");

    // The same-typed source field is preselected (§15 demands an exact match).
    expect(actions()[0]).toEqual({
      key: "create-customer",
      type: "CREATE_RECORD",
      targetObjectCode: "customer",
      values: { phone: { source: "SOURCE_FIELD", fieldKey: "phone" } },
    });

    pick("映射值来源 1-1-1", "固定值");
    expect(actions()[0]).toMatchObject({
      values: { phone: { source: "LITERAL", value: "" } },
    });

    fireEvent.change(screen.getByLabelText("映射固定值 1-1-1"), {
      target: { value: "13800000000" },
    });
    expect(actions()[0]).toMatchObject({
      values: { phone: { source: "LITERAL", value: "13800000000" } },
    });

    fireEvent.click(screen.getByLabelText("删除字段映射 1-1-1"));
    expect(actions()[0]).toMatchObject({ values: {} });
  });

  it("clears CREATE_RECORD mappings when the target object changes", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: { phone: { source: "SOURCE_FIELD", fieldKey: "phone" } },
      },
    ]);

    pick("目标业务表 1-1", "工单");

    expect(actions()[0]).toEqual({
      key: "create-customer",
      type: "CREATE_RECORD",
      targetObjectCode: "work-order",
      values: {},
    });
  });

  it("omits the CREATE_RECORD owner key until an owner is configured", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
    ]);

    expect(Object.keys(actions()[0] ?? {})).toEqual([
      "key",
      "type",
      "targetObjectCode",
      "values",
    ]);
    expect(openOptions("记录负责人 1-1")).toEqual([
      "不指定（沿用默认负责人）",
      "执行人",
      "当前记录负责人",
    ]);

    pick("记录负责人 1-1", "当前记录负责人");
    expect(actions()[0]).toEqual({
      key: "create-customer",
      type: "CREATE_RECORD",
      targetObjectCode: "customer",
      values: {},
      owner: { source: "SOURCE_OWNER" },
    });

    pick("记录负责人 1-1", "不指定（沿用默认负责人）");
    expect(Object.keys(actions()[0] ?? {})).toEqual([
      "key",
      "type",
      "targetObjectCode",
      "values",
    ]);
  });

  it("offers SOURCE_FIELD only for the exact same type and hides it for MEMBER from a list", () => {
    renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: { name: { source: "SOURCE_FIELD", fieldKey: "company_name" } },
      },
    ]);

    // TEXT and TEXTAREA are different types (§15: no widening).
    expect(openOptions("映射来源字段 1-1-1")).toEqual(["公司名称"]);

    pick("添加字段映射 1-1", "负责人");
    expect(openOptions("映射来源字段 1-1-2")).toEqual(["负责人成员"]);
    expect(openOptions("映射值来源 1-1-2")).toEqual(NON_TEMPORAL_SOURCES);
  });

  it("maps a DATE target field with 当前时间加天数 and writes only `source` and `days`", () => {
    const actions = renderEditor([
      {
        key: "create-contract",
        type: "CREATE_RECORD",
        targetObjectCode: "contract",
        values: {},
      },
    ]);

    pick("添加字段映射 1-1", "签订日期");
    expect(openOptions("映射值来源 1-1-1")).toEqual([
      ...NON_TEMPORAL_SOURCES,
      ...TEMPORAL_SOURCES,
    ]);

    pick("映射值来源 1-1-1", "当前时间加天数");
    expect(actions()[0]).toMatchObject({
      values: { signed_on: { source: "NOW_PLUS_DAYS", days: 0 } },
    });
    // Only the two configured keys are sent — no `memberId`, no `value`.
    expect(Object.keys(mappingSource(actions(), 0, "signed_on"))).toEqual([
      "source",
      "days",
    ]);

    fireEvent.change(screen.getByLabelText("映射天数 1-1-1"), {
      target: { value: "7" },
    });
    expect(actions()[0]).toMatchObject({
      values: { signed_on: { source: "NOW_PLUS_DAYS", days: 7 } },
    });
  });

  it("maps ACTOR without serializing an unused memberId", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
    ]);

    pick("添加字段映射 1-1", "负责人");
    pick("映射值来源 1-1-1", "执行人");

    expect(actions()[0]).toEqual({
      key: "create-customer",
      type: "CREATE_RECORD",
      targetObjectCode: "customer",
      values: { owner: { source: "ACTOR" } },
    });
    expect(Object.keys(mappingSource(actions(), 0, "owner"))).toEqual([
      "source",
    ]);
  });

  it("maps a prior CREATE_RECORD output and never a later step", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
      {
        key: "create-contract",
        type: "CREATE_RECORD",
        targetObjectCode: "contract",
        values: {},
      },
    ]);

    pick("添加字段映射 1-2", "签订日期");
    pick("映射值来源 1-2-1", "前序动作输出");

    expect(openOptions("映射动作输出 1-2-1")).toEqual([
      "步骤 1 · 记录 ID",
      "步骤 1 · 业务表代码",
      "步骤 1 · 记录编号",
    ]);

    pick("映射动作输出 1-2-1", "步骤 1 · 记录编号");
    expect(actions()[1]).toMatchObject({
      values: {
        signed_on: {
          source: "ACTION_OUTPUT",
          actionKey: "create-customer",
          property: "recordNo",
        },
      },
    });
  });

  it("offers CREATE_RELATION only the current record and earlier CREATE_RECORD outputs", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
      {
        key: "update-source",
        type: "UPDATE_RECORD",
        target: "SOURCE_RECORD",
        values: {},
      },
      {
        key: "link",
        type: "CREATE_RELATION",
        left: { source: "SOURCE_RECORD" },
        right: { source: "SOURCE_RECORD" },
      },
      {
        key: "create-later",
        type: "CREATE_RECORD",
        targetObjectCode: "work-order",
        values: {},
      },
    ]);

    expect(openOptions("左侧记录 1-3")).toEqual([
      "当前记录",
      "步骤 1（create-customer）",
    ]);
    expect(openOptions("右侧记录 1-3")).toEqual([
      "当前记录",
      "步骤 1（create-customer）",
    ]);

    pick("右侧记录 1-3", "步骤 1（create-customer）");
    expect(actions()[2]).toEqual({
      key: "link",
      type: "CREATE_RELATION",
      left: { source: "SOURCE_RECORD" },
      right: {
        source: "ACTION_OUTPUT",
        actionKey: "create-customer",
        property: "recordId",
      },
    });
  });

  it("configures every CREATE_FOLLOW_UP position", () => {
    const actions = renderEditor([
      {
        key: "follow-up",
        type: "CREATE_FOLLOW_UP",
        target: { source: "SOURCE_RECORD" },
        title: { source: "LITERAL", value: "首次回访" },
        dueAt: { source: "NOW" },
        assignee: { source: "ACTOR" },
      },
    ]);

    expect(openOptions("目标记录 1-1")).toEqual(["当前记录"]);
    expect(openOptions("跟进时间 1-1")).toEqual([
      "当前时间",
      "当前时间加天数",
      "固定时间",
      "当前记录字段",
    ]);
    expect(openOptions("跟进人 1-1")).toEqual([
      "执行人",
      "当前记录负责人",
    ]);

    pick("跟进时间 1-1", "当前时间加天数");
    fireEvent.change(screen.getByLabelText("跟进天数 1-1"), {
      target: { value: "3" },
    });
    expect(actions()[0]).toMatchObject({
      dueAt: { source: "NOW_PLUS_DAYS", days: 3 },
    });

    pick("跟进时间 1-1", "当前记录字段");
    expect(openOptions("跟进时间字段 1-1")).toEqual(["签约日"]);
    pick("跟进时间字段 1-1", "签约日");
    expect(actions()[0]).toMatchObject({
      dueAt: { source: "SOURCE_FIELD", fieldKey: "signed_on" },
    });

    pick("跟进时间 1-1", "固定时间");
    fireEvent.change(screen.getByLabelText("跟进时间点 1-1"), {
      target: { value: "2026-10-01T09:00:00.000Z" },
    });

    pick("标题来源 1-1", "当前记录字段");
    pick("标题字段 1-1", "公司名称");
    pick("跟进人 1-1", "当前记录负责人");

    expect(actions()[0]).toEqual({
      key: "follow-up",
      type: "CREATE_FOLLOW_UP",
      target: { source: "SOURCE_RECORD" },
      title: { source: "SOURCE_FIELD", fieldKey: "company_name" },
      dueAt: { source: "LITERAL_DATETIME", value: "2026-10-01T09:00:00.000Z" },
      assignee: { source: "SOURCE_OWNER" },
    });
  });

  it("caps the follow-up title at 200 characters", () => {
    renderEditor([
      {
        key: "follow-up",
        type: "CREATE_FOLLOW_UP",
        target: { source: "SOURCE_RECORD" },
        title: { source: "LITERAL", value: "首次回访" },
        dueAt: { source: "NOW" },
        assignee: { source: "ACTOR" },
      },
    ]);

    expect(screen.getByLabelText("标题内容 1-1")).toHaveAttribute(
      "maxlength",
      "200",
    );
  });

  it("keeps UPDATE_RECORD on the source record and maps only its own fields", () => {
    const actions = renderEditor([
      {
        key: "update-source",
        type: "UPDATE_RECORD",
        target: "SOURCE_RECORD",
        values: {},
      },
    ]);

    expect(screen.getByText(/目标固定为当前记录/)).toBeInTheDocument();
    expect(screen.queryByLabelText("目标业务表 1-1")).not.toBeInTheDocument();
    expect(openOptions("添加字段映射 1-1")).toEqual([
      "公司名称",
      "手机",
      "预计金额",
      "签约日",
      "备注",
      "负责人成员",
    ]);

    pick("添加字段映射 1-1", "备注");
    expect(actions()[0]).toEqual({
      key: "update-source",
      type: "UPDATE_RECORD",
      target: "SOURCE_RECORD",
      values: { note: { source: "SOURCE_FIELD", fieldKey: "note" } },
    });
  });

  it("explains ASSIGN_OWNER without offering a member or record picker", () => {
    const actions = renderEditor([assignOwner("assign-owner")]);

    expect(screen.getByText("将当前记录分配给执行人。")).toBeInTheDocument();
    expect(screen.queryByLabelText("记录负责人 1-1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("目标业务表 1-1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("目标记录 1-1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("跟进人 1-1")).not.toBeInTheDocument();
    expect(actions()).toEqual([assignOwner("assign-owner")]);
  });

  it("stops at the 50-mapping limit and says so", () => {
    const values = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `field_${index}`,
        { source: "LITERAL" as const, value: "x" },
      ]),
    );
    renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values,
      },
    ]);

    expect(screen.getByLabelText("添加字段映射 1-1")).toBeDisabled();
    expect(screen.getByText("最多 50 个字段映射")).toBeInTheDocument();
  });

  it("stops at the 20-step limit and says so", () => {
    renderEditor(
      Array.from({ length: 20 }, (_, index) => assignOwner(`action-${index + 1}`)),
    );

    expect(screen.getByText("添加执行动作").closest("button")).toBeDisabled();
    expect(screen.getByText(/最多 20 个执行动作/)).toBeInTheDocument();
  });

  it("renders the exact backend field path and message on the offending step", () => {
    renderEditor(
      [
        {
          key: "create-customer",
          type: "CREATE_RECORD",
          targetObjectCode: "customer",
          values: {},
        },
        {
          key: "update-source",
          type: "UPDATE_RECORD",
          target: "SOURCE_RECORD",
          values: {},
        },
      ],
      [
        {
          actionIndex: 1,
          field: "transitions.0.actions.1.values.phone",
          messages: ["「phone」不能为空。"],
        },
      ],
    );

    const paths = screen.getAllByText("transitions.0.actions.1.values.phone");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.closest("[data-action-step]")).toHaveAttribute(
        "data-action-step",
        "2",
      );
    }
    expect(screen.getAllByText("「phone」不能为空。").length).toBeGreaterThan(0);
  });

  it("reports a path that names no step at the editor level", () => {
    renderEditor([assignOwner("assign-owner")], [
      {
        actionIndex: null,
        field: "transitions.0.actions",
        messages: ["执行动作必须是数组。"],
      },
    ]);

    const path = screen.getByText("transitions.0.actions", { exact: true });
    expect(path.closest("[data-action-step]")).toBeNull();
    expect(screen.getByText("执行动作必须是数组。")).toBeInTheDocument();
  });

  it("maps backend field paths to the transition and step they belong to", () => {
    expect(
      actionFieldErrors(
        {
          "transitions.1.actions.2.values.phone": ["手机必填。"],
          "transitions.1.actions": ["执行动作必须是数组。"],
          "transitions.0.actions.0.key": ["仅支持小写字母。"],
          "transitions.1.allowedRoles": ["至少一个角色。"],
        },
        1,
      ),
    ).toEqual([
      {
        actionIndex: 2,
        field: "transitions.1.actions.2.values.phone",
        messages: ["手机必填。"],
      },
      {
        actionIndex: null,
        field: "transitions.1.actions",
        messages: ["执行动作必须是数组。"],
      },
    ]);
  });
});

/**
 * §16/§17: a reference is only valid while the Action it names still exists AND
 * still comes EARLIER — and while that Action still produces the property being
 * read. Ordinary editor operations break every one of those, so each is driven
 * through the same controls an administrator uses. The administrator's choice
 * must survive the flag: the editor reports the step, it never rewrites it.
 */
describe("WorkflowActionEditor reference validation", () => {
  const CREATE_THEN_RELATION: WorkflowActionDraft[] = [
    {
      key: "create-customer",
      type: "CREATE_RECORD",
      targetObjectCode: "customer",
      values: {},
    },
    {
      key: "link",
      type: "CREATE_RELATION",
      left: { source: "SOURCE_RECORD" },
      right: {
        source: "ACTION_OUTPUT",
        actionKey: "create-customer",
        property: "recordId",
      },
    },
  ];

  it("flags the forward reference 上移 creates and keeps the chosen reference", () => {
    const actions = renderEditor(CREATE_THEN_RELATION);

    // Valid to start with: an earlier CREATE_RECORD output.
    expect(screen.queryByText(/必须排在当前步骤之前/)).not.toBeInTheDocument();
    expect(statusClassOf("右侧记录 1-2")).not.toContain("status-error");

    fireEvent.click(screen.getByLabelText("上移步骤 1-2"));

    expect(
      screen.getByText(
        "引用的执行动作「create-customer」是第 2 步，必须排在当前步骤之前。",
      ),
    ).toBeInTheDocument();
    expect(statusClassOf("右侧记录 1-1")).toContain("status-error");
    // The relation still names the step it was configured against: the editor
    // did not quietly drop it back to 当前记录.
    expect(actions()).toEqual([
      {
        key: "link",
        type: "CREATE_RELATION",
        left: { source: "SOURCE_RECORD" },
        right: {
          source: "ACTION_OUTPUT",
          actionKey: "create-customer",
          property: "recordId",
        },
      },
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
    ]);
  });

  it("flags the dangling reference 删除 leaves behind", () => {
    const actions = renderEditor(CREATE_THEN_RELATION);

    fireEvent.click(screen.getByLabelText("删除步骤 1-1"));

    expect(
      screen.getByText(
        "引用的执行动作「create-customer」已不存在，请重新选择或恢复该步骤的编码。",
      ),
    ).toBeInTheDocument();
    expect(statusClassOf("右侧记录 1-1")).toContain("status-error");
    expect(actions()).toEqual([
      {
        key: "link",
        type: "CREATE_RELATION",
        left: { source: "SOURCE_RECORD" },
        right: {
          source: "ACTION_OUTPUT",
          actionKey: "create-customer",
          property: "recordId",
        },
      },
    ]);
  });

  it("flags the dangling reference renaming the referenced key leaves behind", () => {
    const actions = renderEditor(CREATE_THEN_RELATION);

    fireEvent.change(screen.getByLabelText("执行动作编码 1-1"), {
      target: { value: "create-customer-v2" },
    });

    expect(actions()[0]?.key).toBe("create-customer-v2");
    expect(
      screen.getByText(
        "引用的执行动作「create-customer」已不存在，请重新选择或恢复该步骤的编码。",
      ),
    ).toBeInTheDocument();
    // No cascade and no reset: the referencing step keeps the key the
    // administrator chose, and the editor says why it cannot be sent.
    expect(actions()[1]).toMatchObject({
      right: { source: "ACTION_OUTPUT", actionKey: "create-customer" },
    });
  });

  it("names the broken reference in the select instead of the raw key alone", () => {
    renderEditor(CREATE_THEN_RELATION);

    fireEvent.click(screen.getByLabelText("上移步骤 1-2"));

    expect(openOptions("右侧记录 1-1")).toEqual([
      "当前记录",
      "已失效的引用（create-customer）",
    ]);
  });

  it("flags a CREATE_FOLLOW_UP target that no longer precedes the follow-up", () => {
    const actions = renderEditor([
      CREATE_THEN_RELATION[0],
      {
        key: "follow-up",
        type: "CREATE_FOLLOW_UP",
        target: {
          source: "ACTION_OUTPUT",
          actionKey: "create-customer",
          property: "recordId",
        },
        title: { source: "LITERAL", value: "首次回访" },
        dueAt: { source: "NOW" },
        assignee: { source: "ACTOR" },
      },
    ]);

    expect(screen.queryByText(/必须排在当前步骤之前/)).not.toBeInTheDocument();
    expect(statusClassOf("目标记录 1-2")).not.toContain("status-error");

    fireEvent.click(screen.getByLabelText("上移步骤 1-2"));

    expect(
      screen.getByText(
        "引用的执行动作「create-customer」是第 2 步，必须排在当前步骤之前。",
      ),
    ).toBeInTheDocument();
    expect(statusClassOf("目标记录 1-1")).toContain("status-error");
    // 跟进人 is a closed ACTOR / SOURCE_OWNER choice with nothing to reference,
    // so it is never flagged and its value is untouched.
    expect(statusClassOf("跟进人 1-1")).not.toContain("status-error");
    expect(actions()[0]).toMatchObject({ assignee: { source: "ACTOR" } });
  });

  it("flags a mapping that reads an output the referenced step stopped producing", () => {
    renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
      {
        key: "create-contract",
        type: "CREATE_RECORD",
        targetObjectCode: "contract",
        values: {
          signed_on: {
            source: "ACTION_OUTPUT",
            actionKey: "create-customer",
            property: "recordNo",
          },
        },
      },
    ]);

    expect(screen.queryByText(/不提供/)).not.toBeInTheDocument();

    pick("执行动作类型 1-1", "更新当前记录");

    expect(
      screen.getByText(
        "执行动作「create-customer」不提供「记录编号」输出，请重新选择。",
      ),
    ).toBeInTheDocument();
    expect(statusClassOf("映射动作输出 1-2-1")).toContain("status-error");
  });

  it("flags a mapping whose SOURCE_FIELD the record no longer has", () => {
    renderEditor([
      {
        key: "update-source",
        type: "UPDATE_RECORD",
        target: "SOURCE_RECORD",
        values: {
          note: { source: "SOURCE_FIELD", fieldKey: "removed_note" },
        },
      },
    ]);

    expect(
      screen.getByText("引用的当前记录字段「removed_note」已不存在，请重新选择。"),
    ).toBeInTheDocument();
    expect(statusClassOf("映射来源字段 1-1-1")).toContain("status-error");
  });

  it("flags a follow-up title and due-at field the record no longer has", () => {
    renderEditor([
      {
        key: "follow-up",
        type: "CREATE_FOLLOW_UP",
        target: { source: "SOURCE_RECORD" },
        title: { source: "SOURCE_FIELD", fieldKey: "removed_title" },
        dueAt: { source: "SOURCE_FIELD", fieldKey: "removed_date" },
        assignee: { source: "ACTOR" },
      },
    ]);

    expect(
      screen.getByText("引用的当前记录字段「removed_title」已不存在，请重新选择。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("引用的当前记录字段「removed_date」已不存在，请重新选择。"),
    ).toBeInTheDocument();
    expect(statusClassOf("标题字段 1-1")).toContain("status-error");
    expect(statusClassOf("跟进时间字段 1-1")).toContain("status-error");
  });

  it("flags a due-at SOURCE_FIELD that is no longer a date field", () => {
    renderEditor([
      {
        key: "follow-up",
        type: "CREATE_FOLLOW_UP",
        target: { source: "SOURCE_RECORD" },
        title: { source: "LITERAL", value: "首次回访" },
        dueAt: { source: "SOURCE_FIELD", fieldKey: "company_name" },
        assignee: { source: "ACTOR" },
      },
    ]);

    expect(
      screen.getByText("「公司名称」不是日期或时间字段，不能作为跟进时间。"),
    ).toBeInTheDocument();
  });
});

/**
 * The mapping row's target select must offer only fields that are still free,
 * so two rows can never end up writing the same key — which would drop one
 * administrator's mapping without a word.
 */
describe("WorkflowActionEditor mapping rows", () => {
  it("offers only the target fields no other row has claimed", () => {
    renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {
          name: { source: "LITERAL", value: "客户" },
          phone: { source: "LITERAL", value: "13800000000" },
        },
      },
    ]);

    // Each row keeps its OWN field selectable so the current choice is never
    // rendered as a bare key; the field the other row already maps is gone, so
    // a rename onto it — which used to drop that row's source silently — is not
    // reachable at all.
    expect(openOptions("映射目标字段 1-1-1")).toEqual(["客户名称", "负责人"]);
    expect(openOptions("映射目标字段 1-1-2")).toEqual(["手机", "负责人"]);
  });

  it("keeps every mapping when two rows take two different target fields", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: {},
      },
    ]);

    pick("添加字段映射 1-1", "客户名称");
    pick("添加字段映射 1-1", "手机");

    expect(openOptions("映射目标字段 1-1-1")).toEqual(["客户名称", "负责人"]);
    expect(openOptions("映射目标字段 1-1-2")).toEqual(["手机", "负责人"]);
    expect(mappingSource(actions(), 0, "name")).toEqual({
      source: "SOURCE_FIELD",
      fieldKey: "company_name",
    });
    expect(mappingSource(actions(), 0, "phone")).toEqual({
      source: "SOURCE_FIELD",
      fieldKey: "phone",
    });
  });
});

/**
 * The default payload of each Action type, exercised through the type selector
 * the way an administrator reaches it. A wrong default shape (a missing
 * `target: 'SOURCE_RECORD'`, say) would otherwise ship unnoticed.
 */
describe("WorkflowActionEditor type-change defaults", () => {
  it("replaces the payload with the exact default of every Action type", () => {
    const actions = renderEditor([
      {
        key: "create-customer",
        type: "CREATE_RECORD",
        targetObjectCode: "customer",
        values: { name: { source: "LITERAL", value: "客户" } },
      },
    ]);

    pick("执行动作类型 1-1", "更新当前记录");
    expect(actions()).toEqual([
      {
        key: "create-customer",
        type: "UPDATE_RECORD",
        target: "SOURCE_RECORD",
        values: {},
      },
    ]);

    pick("执行动作类型 1-1", "创建待跟进事项");
    expect(actions()).toEqual([
      {
        key: "create-customer",
        type: "CREATE_FOLLOW_UP",
        target: { source: "SOURCE_RECORD" },
        title: { source: "LITERAL", value: "" },
        dueAt: { source: "NOW" },
        assignee: { source: "ACTOR" },
      },
    ]);

    pick("执行动作类型 1-1", "将当前记录分配给执行人");
    expect(actions()).toEqual([
      {
        key: "create-customer",
        type: "ASSIGN_OWNER",
        target: "SOURCE_RECORD",
        owner: { source: "ACTOR" },
      },
    ]);

    pick("执行动作类型 1-1", "建立记录关联");
    expect(actions()).toEqual([
      {
        key: "create-customer",
        type: "CREATE_RELATION",
        left: { source: "SOURCE_RECORD" },
        right: { source: "SOURCE_RECORD" },
      },
    ]);
  });
});
