import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DISPLAY_PREFS,
  legacyOwnerVisibilityKey,
  parseDisplayPrefs,
  readDisplayPrefs,
  recordDisplayKey,
  useRecordDisplayPrefs,
} from "./record-display-prefs";

beforeEach(() => window.localStorage.clear());

describe("record display preferences", () => {
  it("keeps one member's layout away from another member in the same browser", () => {
    const first = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-a", "customers"),
    );
    act(() =>
      first.result.current.update({
        density: "compact",
        columns: ["name"],
        widths: { name: 320 },
      }),
    );
    first.unmount();

    const second = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-b", "customers"),
    );
    expect(second.result.current.prefs).toEqual(DEFAULT_DISPLAY_PREFS);

    const again = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-a", "customers"),
    );
    expect(again.result.current.prefs).toMatchObject({
      density: "compact",
      columns: ["name"],
      widths: { name: 320 },
    });
  });

  it("separates companies and tables for the same member", () => {
    const view = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-a", "customers"),
    );
    act(() => view.result.current.update({ density: "full" }));
    expect(
      window.localStorage.getItem(
        recordDisplayKey("northwind", "member-a", "customers"),
      ),
    ).toContain("full");
    expect(
      window.localStorage.getItem(
        recordDisplayKey("northwind", "member-a", "deals"),
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem(
        recordDisplayKey("acme", "member-a", "customers"),
      ),
    ).toBeNull();
  });

  it("does not adopt the old per-table layout, which has no owner", () => {
    window.localStorage.setItem(
      "crm.records.columns.northwind.customers",
      JSON.stringify(["phone"]),
    );
    window.localStorage.setItem(
      "crm.records.column-widths.northwind.customers",
      JSON.stringify({ phone: 500 }),
    );
    const prefs = readDisplayPrefs(
      "northwind",
      "member-a",
      "customers",
      window.localStorage,
    );
    expect(prefs.columns).toEqual([]);
    expect(prefs.widths).toEqual({});
    // Left as it was, not deleted or rewritten.
    expect(
      window.localStorage.getItem("crm.records.columns.northwind.customers"),
    ).toBe(JSON.stringify(["phone"]));
  });

  it("carries over the owner-column choice, which was already stored per member", () => {
    window.localStorage.setItem(
      legacyOwnerVisibilityKey("northwind", "member-a", "customers"),
      "hidden",
    );
    expect(
      readDisplayPrefs(
        "northwind",
        "member-a",
        "customers",
        window.localStorage,
      ).ownerVisible,
    ).toBe(false);
    expect(
      readDisplayPrefs(
        "northwind",
        "member-b",
        "customers",
        window.localStorage,
      ).ownerVisible,
    ).toBe(true);
  });

  it("persists nothing without a member id", () => {
    const view = renderHook(() =>
      useRecordDisplayPrefs("northwind", undefined, "customers"),
    );
    act(() => view.result.current.update({ density: "compact" }));
    expect(view.result.current.prefs.density).toBe("compact");
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps the default owner visibility after resetting an inherited choice and remounting", () => {
    window.localStorage.setItem(
      legacyOwnerVisibilityKey("northwind", "member-a", "customers"),
      "hidden",
    );
    const view = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-a", "customers"),
    );
    expect(view.result.current.prefs.ownerVisible).toBe(false);

    act(() => view.result.current.reset());
    expect(view.result.current.prefs.ownerVisible).toBe(true);
    view.unmount();

    const again = renderHook(() =>
      useRecordDisplayPrefs("northwind", "member-a", "customers"),
    );
    expect(again.result.current.prefs.ownerVisible).toBe(true);
  });

  it("rejects malformed stored values instead of trusting them", () => {
    expect(parseDisplayPrefs("not json")).toBeNull();
    expect(
      parseDisplayPrefs(
        JSON.stringify({
          columns: ["name", 3, "bad key!", "name"],
          widths: { name: 300, "<script>": 10, phone: "wide" },
          density: "huge",
          columnDensity: { notes: "full", name: "giant" },
        }),
      ),
    ).toEqual({
      columns: ["name"],
      widths: { name: 300 },
      density: "comfortable",
      columnDensity: { notes: "full" },
      ownerVisible: true,
    });
  });
});
