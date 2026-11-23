import { expect, it } from "vitest";
import { formatTokens, formatPercent } from "./format";

it.each([
  [0, "0 token"],
  [60, "60 token"],
  [9999, "9,999 token"],
  [10000, "1.0 万 token"],
  ["216573", "21.7 万 token"],
  ["9223372036854775807", "922,337,203,685,477.6 万 token"],
])("formats %s tokens", (n, text) => expect(formatTokens(n)).toBe(text));
it("keeps one decimal place for usage percentages", () => {
  expect(formatPercent(80)).toBe("80.0%");
  expect(formatPercent(83.46)).toBe("83.5%");
});
