import { describe, expect, it } from "vitest";

import { maskPhone } from "./mask-phone";

describe("maskPhone", () => {
  it("masks an E.164 Chinese mobile as 138****8000", () => {
    expect(maskPhone("+8613800138000")).toBe("138****8000");
  });

  it("masks an already national 11-digit number", () => {
    expect(maskPhone("13900000001")).toBe("139****0001");
  });

  it("returns the original value when it is not 11 digits", () => {
    expect(maskPhone("unknown")).toBe("unknown");
  });
});
