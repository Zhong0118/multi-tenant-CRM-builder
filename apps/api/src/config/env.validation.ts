import { isIP } from 'node:net';
import { z } from 'zod';

function protocol(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}

const productionSchema = z.object({
  NODE_ENV: z.literal('production'),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        protocol(value) &&
        ['postgres:', 'postgresql:'].includes(protocol(value)!),
    ),
  REDIS_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        protocol(value) && ['redis:', 'rediss:'].includes(protocol(value)!),
    ),
  WEB_ORIGIN: z
    .string()
    .url()
    .refine((value) => protocol(value) === 'https:'),
  API_ORIGIN: z
    .string()
    .url()
    .refine((value) => protocol(value) === 'https:'),
  TRUSTED_PROXY_IP: z
    .string()
    .refine((value) => isIP(value) !== 0)
    .optional(),
  PUBLIC_REGISTRATION_ENABLED: z.literal('false'),
  FIRST_ADMIN_PHONE: z.string().trim().min(1),
  AI_PROVIDER: z.literal('openai'),
  AI_MODEL: z.string().trim().min(1),
  AI_API_KEY: z.string().trim().min(1),
  AI_BASE_URL: z
    .string()
    .optional()
    .refine((value) => !value?.trim() || protocol(value.trim()) === 'https:'),
  ATTACHMENTS_STORAGE_DIR: z.string().trim().startsWith('/'),
  SMS_PROVIDER: z.literal('tencent'),
  TENCENT_SMS_SECRET_ID: z.string().trim().min(1),
  TENCENT_SMS_SECRET_KEY: z.string().trim().min(1),
  TENCENT_SMS_SDK_APP_ID: z.string().trim().regex(/^\d+$/),
  TENCENT_SMS_SIGN_NAME: z.string().trim().min(1),
  TENCENT_SMS_REGISTER_TEMPLATE_ID: z.string().trim().regex(/^\d+$/),
  TENCENT_SMS_RESET_TEMPLATE_ID: z.string().trim().regex(/^\d+$/),
});

export function validateProductionConfig(
  env: Record<string, string | undefined>,
) {
  const result = productionSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid production configuration: ${details}`);
  }
  return { ...env, ...result.data };
}

export function validateRuntimeConfig(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production') return validateProductionConfig(env);
  return env;
}
