import { isIP } from 'node:net';
import { normalizeModelBaseURL } from '../modules/ai/governance/model-transport';
import { z } from 'zod';

function protocol(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}

const productionSchema = z
  .object({
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
    WEB_ORIGIN: z.string().refine((value) =>
      value.split(',').every((item) => {
        try {
          const origin = item.trim();
          const url = new URL(origin);
          return url.protocol === 'https:' && url.origin === origin;
        } catch {
          return false;
        }
      }),
    ),
    API_ORIGIN: z
      .string()
      .url()
      .refine((value) => protocol(value) === 'https:'),
    TRUSTED_PROXY_IP: z
      .string()
      .refine((value) => isIP(value) !== 0)
      .optional(),
    PUBLIC_REGISTRATION_ENABLED: z.enum(['false', 'true']),
    FIRST_ADMIN_PHONE: z.string().trim().min(1),
    AI_PROVIDER: z.string().trim().optional(),
    AI_MODEL: z.string().trim().optional(),
    AI_API_KEY: z.string().trim().optional(),
    AI_BASE_URL: z.string().trim().optional(),
    ATTACHMENTS_STORAGE_DIR: z.string().trim().startsWith('/'),
    SMS_PROVIDER: z.literal('tencent'),
    TENCENT_SMS_SECRET_ID: z.string().trim().min(1),
    TENCENT_SMS_SECRET_KEY: z.string().trim().min(1),
    TENCENT_SMS_SDK_APP_ID: z.string().trim().regex(/^\d+$/),
    TENCENT_SMS_SIGN_NAME: z.string().trim().min(1),
    TENCENT_SMS_REGISTER_TEMPLATE_ID: z.string().trim().regex(/^\d+$/),
    TENCENT_SMS_RESET_TEMPLATE_ID: z.string().trim().regex(/^\d+$/),
  })
  .superRefine((env, ctx) => {
    if (
      !env.AI_PROVIDER &&
      !env.AI_MODEL &&
      !env.AI_API_KEY &&
      !env.AI_BASE_URL
    )
      return;
    for (const key of ['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY'] as const) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'required' });
    }
    if (env.AI_PROVIDER && env.AI_PROVIDER !== 'openai')
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'unsupported provider',
      });
    if (env.AI_BASE_URL) {
      try {
        normalizeModelBaseURL(env.AI_BASE_URL);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_BASE_URL'],
          message: 'invalid endpoint',
        });
      }
    }
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
