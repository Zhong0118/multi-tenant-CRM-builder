import { describe, expect, it } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import { recordCardFields } from "./record-card-fields";

const schema = {
  publication: { number: 1, publishedAt: "2026-08-30T00:00:00.000Z" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [
    {
      id: "field-name",
      fieldKey: "name",
      label: "客户名称",
      type: "TEXT",
      required: true,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 1,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-status",
      fieldKey: "lead_status",
      label: "线索状态",
      type: "SINGLE_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [{ key: "new", label: "待联系", color: "BLUE" }],
      },
      sortOrder: 2,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-phone",
      fieldKey: "phone",
      label: "手机号",
      type: "PHONE",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 3,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-city",
      fieldKey: "city",
      label: "城市",
      type: "TEXT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 4,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-note",
      fieldKey: "note",
      label: "备注",
      type: "TEXTAREA",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 5,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "field-hidden",
      fieldKey: "secret",
      label: "内部备注",
      type: "TEXT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 6,
      isSystem: false,
      access: "HIDDEN",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认列表",
    columnFieldKeys: ["name", "lead_status", "phone", "city", "note"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "ALL", update: "OWN" },
} satisfies RuntimeObjectSchema;

describe("recordCardFields", () => {
  it("picks the first default-view status and up to three extra published columns", () => {
    const card = recordCardFields(schema);

    expect(card.status?.fieldKey).toBe("lead_status");
    expect(card.extras.map((field) => field.fieldKey)).toEqual([
      "phone",
      "city",
      "note",
    ]);
  });

  it("skips the title field and unpublished extra columns", () => {
    const card = recordCardFields({
      ...schema,
      defaultView: {
        ...schema.defaultView,
        columnFieldKeys: ["name", "secret", "phone"],
      },
    });

    expect(card.extras.map((field) => field.fieldKey)).toEqual(["phone"]);
  });
});
