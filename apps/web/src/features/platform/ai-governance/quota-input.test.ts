import { describe, expect, it } from "vitest";
import { tokenAmount, quotaInputValue } from "./common";
describe("按万输入额度", () => {
  it("保留正好一个 token 的精度与数据库的额度上限", () => {
    const max = "9223372036854775807";
    expect(tokenAmount(quotaInputValue(max))).toBe(max);
    expect(tokenAmount("922337203685477.5808")).toBeNull();
    expect(tokenAmount("0.0001")).toBe("1");
  });
});
