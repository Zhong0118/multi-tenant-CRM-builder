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
