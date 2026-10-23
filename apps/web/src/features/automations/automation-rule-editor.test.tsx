import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutomationRuleEditor } from "./automation-rule-editor";
import type { AutomationRule, AutomationTable } from "./automation-types";
const fields = [
  {
    fieldKey: "name",
    label: "客户名称",
    type: "TEXT" as const,
    required: true,
    config: {},
    defaultValue: null,
  },
];
const source: AutomationTable = { code: "customer", name: "客户", fields };
const target: AutomationTable = { code: "order", name: "开单", fields };
const rule: AutomationRule = {
  key: "confirm-order",
  label: "确认开单",
  enabled: true,
  allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
  trigger: { type: "MANUAL" },
  targetObjectCode: "order",
  owner: "SOURCE_OWNER",
  mappings: { name: { source: "SOURCE_FIELD", fieldKey: "name" } },
};
describe("AutomationRuleEditor", () => {
  it("saves explicit mappings and a stable key without editing source data", () => {
    const save = vi.fn();
    render(
      <AutomationRuleEditor
        initial={rule}
        source={source}
        targets={[target]}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("规则名称"), {
      target: { value: "确认签约" },
    });
    fireEvent.click(screen.getByText("保存规则草稿"));
    expect(save).toHaveBeenCalledWith({ ...rule, label: "确认签约" });
  });
  it("blocks saving when a required target field has no source", () => {
    const save = vi.fn();
    render(
      <AutomationRuleEditor
        initial={{ ...rule, mappings: {} }}
        source={source}
        targets={[target]}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("保存规则草稿"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("客户名称：请选择取值方式")).toBeInTheDocument();
  });
});

it("lets an administrator close a read-only published rule", () => {
  const close = vi.fn();
  render(
    <AutomationRuleEditor
      initial={rule}
      source={source}
      targets={[target]}
      onSave={vi.fn()}
      onCancel={close}
      readOnly
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /关\s*闭/ }));
  expect(close).toHaveBeenCalledOnce();
});

it("explains a select condition using its label rather than its stored key", () => {
  const status = {
    ...fields[0],
    fieldKey: "stage",
    label: "客户阶段",
    type: "SINGLE_SELECT" as const,
    config: { options: [{ key: "signed", label: "已开单" }] },
  };
  render(
    <AutomationRuleEditor
      initial={{
        ...rule,
        trigger: { type: "FIELD_CHANGED", fieldKey: "stage", equals: "signed" },
      }}
      source={{ ...source, fields: [...fields, status] }}
      targets={[target]}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(
    screen.getByText("「客户阶段」变为「已开单」时，在「开单」新增一条记录"),
  ).toBeInTheDocument();
});
