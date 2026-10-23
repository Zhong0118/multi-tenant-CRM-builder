import { describe, expect, it } from "vitest";

import { fieldSavePayload, selectOptionsProblem, type FieldDraftValues } from "./field-editor-form";

function values(next: Partial<FieldDraftValues>): FieldDraftValues {
  return {
    fieldKey: "status",
    label: "状态",
    type: "TEXT",
    required: false,
    employeeAccess: "EDIT",
    options: [],
    help: "",
    ...next,
  };
}

const option = (key: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") => ({
  key,
  label: key,
  status,
  color: "BLUE" as const,
});

describe("fieldSavePayload", () => {
  it("drops options left over after switching a select to text", () => {
    const payload = fieldSavePayload(values({ type: "TEXT", options: [option("a")], maxLength: 20 }), {
      validation: {},
      config: { options: [option("a")], placeholder: "例如" },
    });
    expect(payload.config).toEqual({ placeholder: "例如" });
    expect(payload.validation).toEqual({ maxLength: 20 });
  });

  it("drops length rules left over after switching text to a select", () => {
    const payload = fieldSavePayload(
      values({ type: "MULTI_SELECT", options: [option("a")], minLength: 2, maxLength: 20 }),
      { validation: { minLength: 2, maxLength: 20 }, config: {} },
    );
    expect(payload.validation).toEqual({});
    expect(payload.config).toEqual({ options: [option("a")] });
  });

  it("keeps a phone's country, which the editor does not manage, and never adds length rules to email", () => {
    expect(
      fieldSavePayload(values({ type: "PHONE", maxLength: 11 }), { validation: { country: "CN" }, config: {} }).validation,
    ).toEqual({ maxLength: 11, country: "CN" });
    expect(
      fieldSavePayload(values({ type: "EMAIL", maxLength: 11 }), { validation: {}, config: {} }).validation,
    ).toEqual({});
  });
});

describe("selectOptionsProblem", () => {
  it("rejects a select with no options or with every option retired", () => {
    expect(selectOptionsProblem(values({ type: "SINGLE_SELECT" }))).toMatch(/至少添加一个选项/);
    expect(
      selectOptionsProblem(values({ type: "MULTI_SELECT", options: [option("a", "INACTIVE"), option("b", "INACTIVE")] })),
    ).toMatch(/所有选项都已停用/);
    expect(selectOptionsProblem(values({ type: "MULTI_SELECT", options: [option("a", "INACTIVE"), option("b")] }))).toBeUndefined();
    expect(selectOptionsProblem(values({ type: "SINGLE_SELECT", options: [option("a"), option("a")] }))).toMatch(/不能重复/);
    expect(selectOptionsProblem(values({ type: "TEXT" }))).toBeUndefined();
  });
});
