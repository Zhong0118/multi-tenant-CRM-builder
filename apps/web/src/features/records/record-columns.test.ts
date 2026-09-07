import { describe, expect, it } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import {
  parseStoredRecordColumnKeys,
  resolveRecordColumnKeys,
} from "./record-columns";

const schema = {
  object: { titleFieldKey: "name", code: "customers" },
  fields: [
    { fieldKey: "name", access: "EDIT" },
    { fieldKey: "phone", access: "EDIT" },
    { fieldKey: "secret", access: "HIDDEN" },
    { fieldKey: "city", access: "READ_ONLY" },
  ],
  defaultView: { columnFieldKeys: ["name", "phone", "secret"] },
} as unknown as RuntimeObjectSchema;

describe("resolveRecordColumnKeys", () => {
  it("falls back to the published visible default columns", () => {
    expect(resolveRecordColumnKeys(schema, undefined)).toEqual([
      "name",
      "phone",
    ]);
  });

  it("keeps a personal order and drops hidden or unknown fields", () => {
    expect(
      resolveRecordColumnKeys(schema, ["city", "secret", "phone", "missing"]),
    ).toEqual(["city", "phone"]);
  });
});

describe("parseStoredRecordColumnKeys", () => {
  it("reads a stored field-key array and ignores junk", () => {
    expect(parseStoredRecordColumnKeys('["phone","name"]')).toEqual([
      "phone",
      "name",
    ]);
    expect(parseStoredRecordColumnKeys("not-json")).toEqual([]);
    expect(parseStoredRecordColumnKeys('["Bad Key"]')).toEqual([]);
  });
});
