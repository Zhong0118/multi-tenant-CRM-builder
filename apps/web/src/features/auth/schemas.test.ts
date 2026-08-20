import { describe, expect, it } from "vitest";

import { passwordSchema, phoneSchema, verificationCodeSchema } from "./schemas";

describe("authentication schemas", () => {
  it.each(["a123456789", "crm-password-2026"])(
    "accepts a strong password: %s",
    (password) => {
      expect(passwordSchema.safeParse(password).success).toBe(true);
    },
  );

  it.each(["a12345678", "abcdefghij", "1234567890"])(
    "rejects a password outside the shared policy: %s",
    (password) => {
      expect(passwordSchema.safeParse(password).success).toBe(false);
    },
  );

  it("counts password length by Unicode code points", () => {
    expect(passwordSchema.safeParse("a1234567😀").success).toBe(false);
    expect(passwordSchema.safeParse("a12345678😀").success).toBe(true);
    expect(passwordSchema.safeParse("a1234567✈️").success).toBe(true);
    expect(passwordSchema.safeParse(`a1${"😀".repeat(70)}`).success).toBe(true);
    expect(passwordSchema.safeParse(`a1${"😀".repeat(71)}`).success).toBe(
      false,
    );
  });

  it("accepts only mainland mobile numbers and six digit codes", () => {
    expect(phoneSchema.safeParse("13800138000").success).toBe(true);
    expect(phoneSchema.safeParse("12800138000").success).toBe(false);
    expect(verificationCodeSchema.safeParse("123456").success).toBe(true);
    expect(verificationCodeSchema.safeParse("12345a").success).toBe(false);
  });
});
