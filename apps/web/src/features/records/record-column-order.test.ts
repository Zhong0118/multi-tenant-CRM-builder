import { describe, expect, it } from "vitest";

import {
  defaultColumnOrder,
  fieldKeysOf,
  isColumnOrderId,
  resolveColumnOrder,
  systemColumnId,
  systemColumnKey,
  type SystemColumnKey,
} from "./record-column-order";

const ALL: SystemColumnKey[] = [
  "recordNo",
  "systemOwner",
  "poolStatus",
  "updatedAt",
];

describe("record column order", () => {
  it("keeps system column ids apart from business field keys", () => {
    expect(systemColumnId("updatedAt")).toBe("system:updatedAt");
    expect(systemColumnKey("system:recordNo")).toBe("recordNo");
    // A field may be called updated_at; it is never the system column.
    expect(systemColumnKey("updated_at")).toBeNull();
    expect(systemColumnKey("system:somethingElse")).toBeNull();
    expect(isColumnOrderId("system:poolStatus")).toBe(true);
    expect(isColumnOrderId("name")).toBe(true);
    expect(isColumnOrderId("closeDate")).toBe(true);
    expect(isColumnOrderId("contractNo")).toBe(true);
    expect(isColumnOrderId("system:drop_table")).toBe(false);
    expect(isColumnOrderId("Bad Key")).toBe(false);
    expect(
      fieldKeysOf(["system:recordNo", "name", "system:updatedAt", "phone"]),
    ).toEqual(["name", "phone"]);
  });

  it("uses the published arrangement when nothing is saved (older preferences)", () => {
    expect(resolveColumnOrder([], ["name", "phone"], ALL)).toEqual([
      "system:recordNo",
      "name",
      "phone",
      "system:systemOwner",
      "system:poolStatus",
      "system:updatedAt",
    ]);
    expect(defaultColumnOrder(["name"], ["recordNo", "updatedAt"])).toEqual([
      "system:recordNo",
      "name",
      "system:updatedAt",
    ]);
  });

  it("puts system columns between fields in the saved order", () => {
    expect(
      resolveColumnOrder(
        [
          "name",
          "system:updatedAt",
          "system:recordNo",
          "phone",
          "system:systemOwner",
        ],
        ["name", "phone"],
        ["recordNo", "systemOwner", "updatedAt"],
      ),
    ).toEqual([
      "name",
      "system:updatedAt",
      "system:recordNo",
      "phone",
      "system:systemOwner",
    ]);
  });

  it("never shows what is not available now, and places what is new by its neighbour", () => {
    const saved = [
      "system:updatedAt",
      "phone",
      "secret_margin",
      "name",
      "system:systemOwner",
      "system:recordNo",
    ];
    // secret_margin lost permission, the owner column is off for this member,
    // and a new field (score) was published after phone.
    expect(
      resolveColumnOrder(
        saved,
        ["phone", "score", "name"],
        ["recordNo", "updatedAt"],
      ),
    ).toEqual([
      "system:updatedAt",
      "phone",
      "score",
      "name",
      "system:recordNo",
    ]);
  });

  it("lists fields in the order of the field columns, so exports match the table", () => {
    expect(
      resolveColumnOrder(
        ["phone", "system:recordNo", "name"],
        ["name", "phone"],
        ["recordNo", "updatedAt"],
      ),
    ).toEqual(["name", "system:recordNo", "phone", "system:updatedAt"]);
  });
});
