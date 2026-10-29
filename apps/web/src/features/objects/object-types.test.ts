import type { components } from "@crm/contracts";
import { describe, expect, it } from "vitest";

import {
  FIELD_KEY_PATTERN,
  OBJECT_CODE_PATTERN,
  parseRuntimeObjectSchema,
  selectOptions,
  type PublishedFieldView,
} from "./object-types";

type SchemaResponse = components["schemas"]["PublishedObjectSchemaResponseDto"];

function schemaResponse(overrides: Partial<SchemaResponse> = {}) {
  return {
    publication: { number: 3, publishedAt: "2026-08-21T02:00:00.000Z" },
    object: {
      code: "customers",
      name: "客户资料",
      description: null,
      titleFieldKey: "customer_name",
      icon: null,
      sortOrder: 10,
    },
    fields: [
      {
        id: "field-name",
        fieldKey: "customer_name",
        label: "客户名称",
        type: "TEXT",
        required: true,
        defaultValue: null,
        validation: { minLength: 2, maxLength: 60 },
        config: {},
        sortOrder: 1,
        isSystem: false,
        access: "EDIT",
      },
    ],
    defaultView: {
      code: "default",
      name: "默认视图",
      columnFieldKeys: ["customer_name"],
      sort: { field: "updatedAt", direction: "desc" },
    },
    actions: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    },
    scopes: { read: "OWN", update: "OWN" },
    ...overrides,
  } as unknown as SchemaResponse;
}

describe("parseRuntimeObjectSchema", () => {
  it.each([true, false, undefined])("preserves the published workflow capability (%s)", (workflowEnabled) => {
    const response = { ...schemaResponse(), workflowEnabled };
    expect(parseRuntimeObjectSchema(response)).toHaveProperty("workflowEnabled", workflowEnabled);
  });

  it("accepts authorized GROUP reads while refusing GROUP writes", () => {
    expect(
      parseRuntimeObjectSchema(
        schemaResponse({ scopes: { read: "GROUP", update: "OWN" } }),
      ).scopes,
    ).toEqual({ read: "GROUP", update: "OWN" });
    expect(() =>
      parseRuntimeObjectSchema(
        schemaResponse({ scopes: { read: "OWN", update: "GROUP" } }),
      ),
    ).toThrow();
  });

  it("narrows the loose contract response into typed runtime values", () => {
    const schema = parseRuntimeObjectSchema(schemaResponse());

    expect(schema.publication.number).toBe(3);
    expect(schema.object.titleFieldKey).toBe("customer_name");
    expect(schema.defaultView.sort).toEqual({
      field: "updatedAt",
      direction: "desc",
    });
    expect(schema.actions.canCreate).toBe(true);
    expect(schema.scopes.read).toBe("OWN");
    expect(schema.fields[0].validation.maxLength).toBe(60);
    expect(schema.defaultView.searchFieldKeys).toBeUndefined();
  });

  it("keeps optional searchFieldKeys that reference published fields", () => {
    const schema = parseRuntimeObjectSchema(
      schemaResponse({
        defaultView: {
          code: "default",
          name: "默认视图",
          columnFieldKeys: ["customer_name"],
          searchFieldKeys: ["customer_name"],
          sort: { field: "updatedAt", direction: "desc" },
        },
      } as unknown as Partial<SchemaResponse>),
    );

    expect(schema.defaultView.searchFieldKeys).toEqual(["customer_name"]);
  });

  it("rejects a response whose scopes are not a published data scope", () => {
    expect(() =>
      parseRuntimeObjectSchema(
        schemaResponse({
          scopes: { read: "EVERYTHING", update: "OWN" },
        } as unknown as Partial<SchemaResponse>),
      ),
    ).toThrowError();
  });

  it("rejects a response whose default view column is not a published field", () => {
    expect(() =>
      parseRuntimeObjectSchema(
        schemaResponse({
          defaultView: {
            code: "default",
            name: "默认视图",
            columnFieldKeys: ["unknown_field"],
            sort: { field: "updatedAt", direction: "desc" },
          },
        } as unknown as Partial<SchemaResponse>),
      ),
    ).toThrowError();
  });
});

describe("selectOptions", () => {
  it.each([
    "GRAY",
    "BLUE",
    "CYAN",
    "GREEN",
    "YELLOW",
    "ORANGE",
    "RED",
    "PURPLE",
    "PINK",
    "INDIGO",
    "TEAL",
    "BROWN",
  ])("preserves published option color %s", (color) => {
    const response = schemaResponse();
    response.fields[0].type = "SINGLE_SELECT";
    response.fields[0].config = {
      options: [{ key: "saved", label: "已保存", color }],
    };
    const schema = parseRuntimeObjectSchema(response);

    expect(selectOptions(schema.fields[0])).toEqual([
      { key: "saved", label: "已保存", status: "ACTIVE", color },
    ]);
  });

  it("keeps the legacy fallback cycle for missing or unknown colors", () => {
    const field = {
      config: {
        options: Array.from({ length: 14 }, (_, index) => ({
          key: `option_${index}`,
          label: `选项 ${index}`,
          ...(index % 2 === 0 ? {} : { color: "MAGENTA" }),
        })),
      },
    } as unknown as PublishedFieldView;

    expect(selectOptions(field).map((option) => option.color)).toEqual([
      "BLUE",
      "GREEN",
      "ORANGE",
      "PURPLE",
      "CYAN",
      "YELLOW",
      "RED",
      "BLUE",
      "GREEN",
      "ORANGE",
      "PURPLE",
      "CYAN",
      "YELLOW",
      "RED",
    ]);
  });

  it("gives legacy options distinct visible colors when none were saved", () => {
    const field = {
      config: {
        options: [
          { key: "gold", label: "金牌" },
          { key: "legacy", label: "旧分级", status: "INACTIVE" },
        ],
      },
    } as unknown as PublishedFieldView;

    expect(selectOptions(field)).toEqual([
      { key: "gold", label: "金牌", status: "ACTIVE", color: "BLUE" },
      {
        key: "legacy",
        label: "旧分级",
        status: "INACTIVE",
        color: "GREEN",
      },
    ]);
  });

  it("returns no options for a field that configures none", () => {
    expect(
      selectOptions({ config: {} } as unknown as PublishedFieldView),
    ).toEqual([]);
  });
});

describe("identifier patterns", () => {
  it("keeps object codes on hyphens and field keys on underscores", () => {
    // Mirrors the server rules in objects.service.ts: normalizeObjectCode
    // accepts hyphens and normalizeFieldKey accepts underscores.
    expect(OBJECT_CODE_PATTERN.test("customer-order")).toBe(true);
    expect(OBJECT_CODE_PATTERN.test("customer_order")).toBe(false);
    expect(FIELD_KEY_PATTERN.test("customer_name")).toBe(true);
    expect(FIELD_KEY_PATTERN.test("customer-name")).toBe(false);
  });
});

it("preserves optional group and common query policies without changing own field access", () => {
  const response = schemaResponse({
    groupFieldAccess: { customer_name: "READ_ONLY" },
    queryFieldKeys: ["customer_name"],
  } as Partial<SchemaResponse>);
  const parsed = parseRuntimeObjectSchema(response);
  expect(parsed.groupFieldAccess).toEqual({ customer_name: "READ_ONLY" });
  expect(parsed.queryFieldKeys).toEqual(["customer_name"]);
  expect(parsed.fields[0].access).toBe("EDIT");
  expect(
    parseRuntimeObjectSchema(schemaResponse()).groupFieldAccess,
  ).toBeUndefined();
  expect(
    parseRuntimeObjectSchema(schemaResponse()).queryFieldKeys,
  ).toBeUndefined();
});
it("rejects invalid group access values and unknown query fields", () => {
  expect(() =>
    parseRuntimeObjectSchema(
      schemaResponse({
        groupFieldAccess: { customer_name: "WRITE" },
      } as unknown as Partial<SchemaResponse>),
    ),
  ).toThrow();
  expect(() =>
    parseRuntimeObjectSchema(
      schemaResponse({ queryFieldKeys: ["secret"] } as Partial<SchemaResponse>),
    ),
  ).toThrow();
});
