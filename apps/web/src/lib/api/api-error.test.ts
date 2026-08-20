import { describe, expect, it } from "vitest";

import { toApiError } from "./api-error";

describe("toApiError", () => {
  it("preserves a valid API error body", () => {
    expect(
      toApiError({
        code: "VALIDATION_FAILED",
        message: "提交内容有误，请检查后重试。",
        fieldErrors: { phone: ["请输入有效的手机号。"] },
        requestId: "req_123",
        status: 400,
      }),
    ).toEqual({
      code: "VALIDATION_FAILED",
      message: "提交内容有误，请检查后重试。",
      fieldErrors: { phone: ["请输入有效的手机号。"] },
      requestId: "req_123",
      status: 400,
    });
  });

  it("normalizes an unknown response to a safe fallback", () => {
    expect(toApiError("upstream unavailable", 502)).toEqual({
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后重试。",
      fieldErrors: {},
      requestId: "req_unknown",
      status: 502,
    });
  });

  it("drops malformed field errors instead of trusting response data", () => {
    expect(
      toApiError({
        code: "VALIDATION_FAILED",
        message: "invalid",
        fieldErrors: { phone: "not-an-array", code: ["bad", 1] },
        requestId: "req_456",
        status: 400,
      }).fieldErrors,
    ).toEqual({});
  });
});
