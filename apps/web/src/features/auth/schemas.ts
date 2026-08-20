import { z } from "zod";

export const phoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/u, "请输入有效的中国大陆手机号。");

export const verificationCodeSchema = z
  .string()
  .regex(/^\d{6}$/u, "请输入 6 位数字验证码。");

export const passwordSchema = z
  .string()
  .refine((value) => Array.from(value).length >= 10, "密码至少需要 10 位。")
  .refine((value) => Array.from(value).length <= 72, "密码最多允许 72 位。")
  .regex(/[A-Za-z]/u, "密码必须包含至少一个字母。")
  .regex(/\d/u, "密码必须包含至少一个数字。");

export const registerSchema = z.object({
  phone: phoneSchema,
  code: verificationCodeSchema,
  displayName: z.string().trim().min(1, "请输入姓名。").max(100),
  password: passwordSchema,
  deviceSummary: z.string().trim().max(300),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "请输入密码。").max(200),
  deviceKey: z.string().min(8).max(200),
  deviceSummary: z.string().trim().max(300),
});

export const resetPasswordSchema = z.object({
  phone: phoneSchema,
  code: verificationCodeSchema,
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
