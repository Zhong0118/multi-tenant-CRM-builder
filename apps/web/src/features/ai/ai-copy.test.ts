import { describe, expect, it } from "vitest";

import { conversationTime } from "./ai-copy";

describe("conversationTime", () => {
  const now = new Date(2026, 9, 24, 15, 0);

  it("shows the time for today, the date this year, and the year otherwise", () => {
    expect(
      conversationTime(new Date(2026, 9, 24, 9, 5).toISOString(), now),
    ).toBe("09:05");
    expect(
      conversationTime(new Date(2026, 8, 3, 9, 5).toISOString(), now),
    ).toBe("9月3日");
    expect(conversationTime(new Date(2025, 11, 30).toISOString(), now)).toBe(
      "2025年12月30日",
    );
    expect(conversationTime("bad", now)).toBe("");
  });
});
