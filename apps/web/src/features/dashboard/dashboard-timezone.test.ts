import { describe, expect, it, vi } from "vitest";

import {
  datetimeLocalToUtcIso,
  datetimeLocalUtcCandidates,
  utcIsoToDatetimeLocal,
} from "./dashboard-timezone";

describe("dashboard tenant timezone conversion", () => {
  it("round-trips a Shanghai wall clock through canonical UTC", () => {
    const iso = datetimeLocalToUtcIso(
      "2026-09-01T08:30:15.250",
      "Asia/Shanghai",
    );

    expect(iso).toBe("2026-09-01T00:30:15.250Z");
    expect(utcIsoToDatetimeLocal(iso ?? "", "Asia/Shanghai")).toBe(
      "2026-09-01T08:30:15.250",
    );
  });

  it("uses the New York DST offset for the selected wall-clock date", () => {
    expect(
      datetimeLocalToUtcIso("2026-07-04T09:15:00.000", "America/New_York"),
    ).toBe("2026-07-04T13:15:00.000Z");
    expect(
      utcIsoToDatetimeLocal("2026-12-04T14:15:00.000Z", "America/New_York"),
    ).toBe("2026-12-04T09:15:00.000");
  });

  it("preserves the existing instant during a New York DST overlap", () => {
    const original = "2026-11-01T06:30:00.000Z";
    const wallClock = utcIsoToDatetimeLocal(original, "America/New_York");

    expect(datetimeLocalToUtcIso(wallClock, "America/New_York", original)).toBe(
      original,
    );
  });
});

it("reuses offset probes for a sheet with many different times on one day", () => {
  const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
  try {
    for (let minute = 0; minute < 30; minute++) {
      const wallClock = "2025-03-02T10:" + String(minute).padStart(2, "0");
      expect(datetimeLocalUtcCandidates(wallClock, "Pacific/Auckland")).toEqual(
        ["2025-03-01T21:" + String(minute).padStart(2, "0") + ":00.000Z"],
      );
    }
    expect(format.mock.calls.length).toBeLessThan(300);
  } finally {
    format.mockRestore();
  }
});

it("keeps both offsets for half-hour folds and handles an entire skipped calendar day at midnight", () => {
  expect(
    datetimeLocalUtcCandidates("2024-04-07T01:45:00", "Australia/Lord_Howe"),
  ).toEqual(["2024-04-06T14:45:00.000Z", "2024-04-06T15:15:00.000Z"]);
  expect(
    datetimeLocalUtcCandidates("2011-12-29T23:59:59", "Pacific/Apia"),
  ).toEqual(["2011-12-30T09:59:59.000Z"]);
  expect(
    datetimeLocalUtcCandidates("2011-12-30T00:00:00", "Pacific/Apia"),
  ).toEqual([]);
  expect(
    datetimeLocalUtcCandidates("2011-12-30T23:59:59", "Pacific/Apia"),
  ).toEqual([]);
  expect(
    datetimeLocalUtcCandidates("2011-12-31T00:00:00", "Pacific/Apia"),
  ).toEqual(["2011-12-30T10:00:00.000Z"]);
});
