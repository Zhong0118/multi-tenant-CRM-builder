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
  DATABASE_URL: z.string().url().refine((value) => protocol(value) && ['postgres:', 'postgresql:'].includes(protocol(value)!)),
  REDIS_URL: z.string().url().refine((value) => protocol(value) && ['redis:', 'rediss:'].includes(protocol(value)!)),
  WEB_ORIGIN: z.string().url().refine((value) => protocol(value) === 'https:'),
  API_ORIGIN: z.string().url().refine((value) => protocol(value) === 'https:'),
  PUBLIC_REGISTRATION_ENABLED: z.literal('false'),
  FIRST_ADMIN_PHONE: z.string().min(1),
});

export function validateProductionConfig(env: Record<string, string | undefined>) {
  const result = productionSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid production configuration: ${details}`);
  }
  return { ...env, ...result.data };
}

export function validateRuntimeConfig(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production') return validateProductionConfig(env);
  return env;
}
