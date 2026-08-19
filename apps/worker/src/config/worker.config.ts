import { z } from "zod";

const workerEnvSchema = z.object({
  REDIS_URL: z
    .string({ error: "REDIS_URL is required" })
    .url("REDIS_URL must be a valid URL")
    .refine(
      (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
      "REDIS_URL must use redis:// or rediss://",
    ),
});

export interface WorkerConfig {
  redisUrl: string;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  const result = workerEnvSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid worker configuration: ${details}`);
  }

  return { redisUrl: result.data.REDIS_URL };
}
