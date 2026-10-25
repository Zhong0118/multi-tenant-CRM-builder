import { describe, expect, it } from "vitest";

import { calendarDate, describeDue } from "./due";

const tz = "Asia/Shanghai";
// 2026-10-24 10:00 in Shanghai (a Saturday).
const now = Date.parse("2026-10-24T02:00:00.000Z");

describe("describeDue", () => {
  it("counts days on the company calendar, not the browser's", () => {
    // 23:30 in Shanghai on the 24th is still today there.
    expect(describeDue("2026-10-24T15:30:00.000Z", tz, now)).toMatchObject({
      label: "今天 23:30",
      tone: "warning",
      overdue: false,
    });
    expect(describeDue("2026-10-24T16:30:00.000Z", tz, now).label).toBe(
      "明天 00:30",
    );
  });

  it("says how late an overdue item is", () => {
    expect(describeDue("2026-10-24T01:00:00.000Z", tz, now)).toMatchObject({
      label: "已逾期 · 今天 09:00",
      tone: "danger",
      overdue: true,
    });
    expect(describeDue("2026-10-21T01:00:00.000Z", tz, now).label).toBe(
      "已逾期 3 天",
    );
  });

  it("uses the weekday within a week and the date beyond it", () => {
    expect(describeDue("2026-10-27T01:30:00.000Z", tz, now).label).toBe(
      "周二 09:30",
    );
    expect(describeDue("2026-11-05T01:30:00.000Z", tz, now).label).toBe(
      "11月5日 09:30",
    );
    expect(describeDue("2027-01-05T01:30:00.000Z", tz, now).label).toBe(
      "2027年1月5日 09:30",
    );
    expect(describeDue("2026-10-27T01:30:00.000Z", tz, now).full).toBe(
      "2026-10-27 09:30（周二）",
    );
  });

  it("gives the company-calendar date of an instant", () => {
    expect(calendarDate("2026-10-24T16:30:00.000Z", tz)).toBe("2026-10-25");
  });
});
