import { describe, expect, it } from "vitest";
import { ineligible } from "./model-data";
import { modelEntry } from "./presets";

describe("模型可分配条件", () => {
  for (const purpose of ["text", "vision"] as const) {
    it(purpose + " 必须同时声明上下文和最大输出", () => {
      const complete = modelEntry(
        "glm-4.6v",
        ["text", "vision"],
        128000,
        16000,
      );
      const reasons = (
        contextTokens: number | null,
        maxOutputTokens: number | null,
      ) =>
        ineligible(
          { ...complete, contextTokens, maxOutputTokens },
          purpose,
          [{ name: "AI 建表", tokens: 16000 }],
          false,
        );
      expect(reasons(null, 16000)).toContain("上下文");
      expect(reasons(128000, null)).toContain("最大输出");
      expect(reasons(100, 16000)).toContain("超过上下文");
      expect(reasons(128000, 16000)).toBe("");
    });
  }
  it("向量用途要求连接开启向量接口", () => {
    const m = modelEntry("embedding", ["embedding"]);
    for (const [enabled, reason] of [
      [false, "连接未开启向量接口"],
      [true, ""],
    ] as const) {
      expect(ineligible(m, "embedding", [], enabled)).toBe(reason);
    }
  });
});
