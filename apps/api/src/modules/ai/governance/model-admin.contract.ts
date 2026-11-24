import { z } from 'zod';

export const purpose = z.enum(['text', 'vision', 'embedding']);
const version = z.int().positive();
const price = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,8})?$/)
  .nullable();
const model = z.strictObject({
  name: z.string().trim().min(1).max(256),
  capabilities: z.array(purpose).max(3),
  contextTokens: z.int().positive().max(2147483647).nullable(),
  maxOutputTokens: z.int().positive().max(2147483647).nullable(),
  inputPrice: price,
  outputPrice: price,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});
const revision = {
  baseURL: z.string().trim().min(1).max(2048),
  protocol: z.enum(['responses', 'chat']),
  embeddings: z.boolean(),
  models: z.array(model).max(200),
};
const draft = z.strictObject({
  name: z.string().trim().min(1).max(120),
  preset: z.string().trim().min(1).max(64),
  ...revision,
});
const revisionAction = z.strictObject({ version, revisionId: z.uuid() });
const test = revisionAction.extend({ model: model.shape.name, purpose });
const step = z.object({
  name: z.string(),
  durationMs: z.int(),
  ok: z.boolean(),
  errorCode: z.string().optional(),
  httpStatus: z.int().optional(),
});
const result = z.strictObject({
  id: z.uuid(),
  sequence: z.int(),
  model: z.string(),
  purpose,
  status: z.enum(['running', 'success', 'failed']),
  steps: z.array(step),
  dimensions: z.int().nullable(),
  durationMs: z.int().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});
const assignment = z.strictObject({
  purpose,
  providerId: z.uuid(),
  revisionId: z.uuid(),
  model: z.string(),
  version,
  dimensions: z.int().nullable(),
});
const publicRevision = z.strictObject({
  id: z.uuid(),
  ...revision,
  keyLast4: z.string().nullable(),
  tests: z.array(result),
});
const provider = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  preset: z.string(),
  enabled: z.boolean(),
  version,
  activeRevisionId: z.uuid().nullable(),
  draftRevisionId: z.uuid().nullable(),
  revisions: z.array(publicRevision),
});
export const modelInputs = {
  draft,
  edit: draft.extend({ version }),
  version: z.strictObject({ version }),
  key: z.strictObject({
    version,
    apiKey: z
      .string()
      .trim()
      .min(5)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/),
  }),
  revisionAction,
  test,
  activate: revisionAction.extend({ confirmReindex: z.boolean().optional() }),
  assign: revisionAction.extend({
    providerId: z.uuid(),
    model: model.shape.name,
    testId: z.uuid(),
    assignmentVersion: z.int().nonnegative(),
    confirmReindex: z.boolean().optional(),
  }),
  status: z.strictObject({ version, enabled: z.boolean() }),
  empty: z.strictObject({}),
};
export const modelOutputs = {
  state: z.strictObject({
    providers: z.array(provider),
    assignments: z.array(assignment),
    environment: z.strictObject({
      configured: z.boolean(),
      missing: z.array(z.string()),
      provider: z.string().nullable(),
      model: z.string().nullable(),
    }),
  }),
  saved: z.strictObject({ id: z.uuid(), version, revisionId: z.uuid() }),
  result,
  discovered: z.strictObject({ models: z.array(z.string()) }),
  ok: z.strictObject({ ok: z.boolean() }),
  rotation: z.strictObject({ rotated: z.int(), remaining: z.int() }),
};
export type Draft = z.infer<typeof draft>;
export type ModelDeclaration = z.infer<typeof model>;
export type ModelTest = z.infer<typeof result>;
export type Assignment = z.infer<typeof assignment>;
export type ModelPurpose = z.infer<typeof purpose>;
export const MODEL_TEST_SUITE_VERSION = '1';
