import { describe, expect, it } from "vitest";

import {
  datetimeLocalToUtcIso,
  utcIsoToDatetimeLocal,
} from "./dashboard-timezone";

describe("dashboard tenant timezone conversion", () => {
  it("round-trips a Shanghai wall clock through canonical UTC", () => {
    const iso = datetimeLocalToUtcIso(
      "2026-09-01T08:30:15.250",
      "Asia/Shanghai",
    );

    expect(iso).toBe("2026-09-01T00:30:15.250Z");
    expect(utcIsoToDatetimeLocal(iso, "Asia/Shanghai")).toBe(
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
});
