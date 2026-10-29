import { describe, expect, it } from "vitest";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import {
  canEditRecord,
  canEditRecordFields,
  recordFields,
  queryFields,
  visibleFields,
} from "./record-access";

const fields = [
  { fieldKey: "name", access: "EDIT" },
  { fieldKey: "secret", access: "EDIT" },
  { fieldKey: "notes", access: "HIDDEN" },
] as RuntimeObjectSchema["fields"];
const schema = {
  publication: { number: 1, publishedAt: "2026-10-29" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["name"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "GROUP", update: "OWN" },
  fields,
  groupFieldAccess: { name: "READ_ONLY", secret: "HIDDEN", notes: "EDIT" },
  queryFieldKeys: ["name"],
} satisfies RuntimeObjectSchema;
const teammate = {
  id: "r1",
  recordNo: "1",
  version: 1,
  title: "组员客户",
  values: {},
  ownershipExpiresAt: null,
  createdAt: "2026-10-29",
  updatedAt: "2026-10-29",
  ownerMemberId: "teammate",
  inPublicPool: false,
  fieldAccess: { name: "READ_ONLY", secret: "HIDDEN", notes: "EDIT" },
  canEditFields: true,
} satisfies RecordSummary;

describe("independent group record field access", () => {
  it("uses each record's actual field map and keeps own legacy access", () => {
    expect(
      recordFields(schema, teammate).map((f) => [f.fieldKey, f.access]),
    ).toEqual([
      ["name", "READ_ONLY"],
      ["notes", "EDIT"],
    ]);
    expect(
      recordFields(schema, { ownerMemberId: "me" } as RecordSummary).map(
        (f) => f.fieldKey,
      ),
    ).toEqual(["name", "secret"]);
    expect(recordFields(schema).map((f) => f.fieldKey)).toEqual([
      "name",
      "secret",
    ]);
  });
  it("does not infer missing row permissions from own access", () => {
    expect(
      recordFields(schema, { ...teammate, fieldAccess: { name: "READ_ONLY" } }),
    ).toEqual([
      expect.objectContaining({ fieldKey: "name", access: "READ_ONLY" }),
    ]);
  });
  it("adds only ordinary field editing while retaining the original operation scope", () => {
    expect(canEditRecordFields(schema, teammate, "me")).toBe(true);
    expect(canEditRecord(schema, teammate, "me")).toBe(false);
    expect(
      canEditRecordFields(
        { ...schema, actions: { ...schema.actions, canUpdate: false } },
        teammate,
        "me",
      ),
    ).toBe(false);
    expect(
      canEditRecordFields(schema, { ...teammate, canEditFields: false }, "me"),
    ).toBe(false);
    expect(
      canEditRecordFields(
        schema,
        { ownerMemberId: "me", inPublicPool: false } as RecordSummary,
        "me",
      ),
    ).toBe(true);
  });
  it("does not inherit constructor access from an empty group map", () => {
    const constructorField = {
      ...fields[0],
      fieldKey: "constructor",
      access: "HIDDEN" as const,
    };
    const current = {
      ...schema,
      fields: [constructorField],
      groupFieldAccess: {},
    };
    expect(visibleFields(current)).toEqual([]);
    expect(
      visibleFields({
        ...current,
        groupFieldAccess: { constructor: "READ_ONLY" as const },
      }),
    ).toEqual([constructorField]);
  });
  it("does not inherit constructor access from an empty record map", () => {
    const constructorField = {
      ...fields[0],
      fieldKey: "constructor",
      access: "EDIT" as const,
    };
    const current = { ...schema, fields: [constructorField] };
    expect(recordFields(current, { ...teammate, fieldAccess: {} })).toEqual([]);
    expect(
      recordFields(current, {
        ...teammate,
        fieldAccess: { constructor: "EDIT" as const },
      }),
    ).toEqual([constructorField]);
  });
  it("offers union columns but only shared query fields", () => {
    expect(visibleFields(schema).map((f) => f.fieldKey)).toEqual([
      "name",
      "secret",
      "notes",
    ]);
    expect(queryFields(schema).map((f) => f.fieldKey)).toEqual(["name"]);
    expect(
      queryFields({ ...schema, queryFieldKeys: undefined }).map(
        (f) => f.fieldKey,
      ),
    ).toEqual(["name", "secret"]);
    expect(queryFields({ ...schema, queryFieldKeys: [] })).toEqual([]);
  });
});
