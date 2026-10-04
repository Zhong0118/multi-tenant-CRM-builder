import { describe, expect, it } from "vitest";
import { validatedReturnTo, sourceRecordHref, markSourceReturnFocus, consumeSourceReturnFocus } from "./source-navigation";

describe("record source navigation", () => {
  it("consumes a local marker once and only for its exact tenant and source query", () => {
    sessionStorage.clear();
    markSourceReturnFocus("northwind", "/workspace/northwind/follow-ups?status=DONE&page=3");
    expect(consumeSourceReturnFocus("other", "/workspace/other/follow-ups?status=DONE&page=3")).toBe(false);
    expect(consumeSourceReturnFocus("northwind", "/workspace/northwind/follow-ups?status=DONE&page=2")).toBe(false);
    expect(consumeSourceReturnFocus("northwind", "/workspace/northwind/follow-ups?status=DONE&page=3")).toBe(true);
    expect(consumeSourceReturnFocus("northwind", "/workspace/northwind/follow-ups?status=DONE&page=3")).toBe(false);
  });
  it.each(["/workspace/other", "/workspace/northwind/settings", "/workspace/northwind?extra=1"])("never stores an invalid return marker %s", (source) => {
    sessionStorage.clear();
    markSourceReturnFocus("northwind", source);
    expect(sessionStorage.getItem("crm:source-return-focus")).toBeNull();
  });
  it.each([
    "/workspace/northwind?from=2026-10-01&to=2026-10-04",
    "/workspace/northwind/dashboards/sales?from=2026-10-01&to=2026-10-04",
    "/workspace/northwind/follow-ups?status=DONE&page=3",
  ])("returns the exact same-tenant source %s", (source) => {
    expect(validatedReturnTo("northwind", source)).toBe(source);
  });
  it.each([
    "https://evil.example/workspace/northwind", "//evil.example/workspace/northwind",
    "/workspace/other", "/workspace/northwind/settings", "/workspace/northwind/members",
    "/workspace/northwind/dashboards/sales/edit", "/workspace/northwind/dashboards/%2e%2e",
    "/workspace/northwind/../other", "/workspace/northwind\\evil", "/workspace/northwind#evil",
    "/workspace/northwind?returnTo=https://evil.example", "/workspace/northwind/follow-ups?status=OTHER",
    "/workspace/northwind/follow-ups?page=0", "/workspace/northwind/follow-ups?page=2&page=3",
  ])("rejects unsafe or unsupported source %s", (source) => {
    expect(validatedReturnTo("northwind", source)).toBeUndefined();
  });
  it("carries the exact task and encoded source without altering ordinary links", () => {
    expect(sourceRecordHref("northwind", "orders", "r1", "/workspace/northwind/follow-ups?status=DONE&page=3", "task-1"))
      .toBe("/workspace/northwind/objects/orders/r1?followUp=task-1&returnTo=%2Fworkspace%2Fnorthwind%2Ffollow-ups%3Fstatus%3DDONE%26page%3D3");
    expect(sourceRecordHref("northwind", "orders", "r1", "/workspace/other"))
      .toBe("/workspace/northwind/objects/orders/r1");
  });
});
