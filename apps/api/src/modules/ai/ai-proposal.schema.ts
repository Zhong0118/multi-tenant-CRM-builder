import { z } from 'zod';

const target = {
  objectCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  recordId: z.uuid(),
};
const forbiddenFieldKeys = new Set(['tenantId', 'memberId', 'userId', 'role', 'ownerMemberId', 'runAsAdmin', 'runAsSystem', 'readScope', 'updateScope', 'includeHidden', 'bypassPermission']);
const scalar = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const fieldValue = z.union([scalar, z.array(scalar).max(100)]);
const candidateSchema = z.discriminatedUnion('operationType', [
  z.strictObject({
    operationType: z.literal('UPDATE_RECORD'),
    ...target,
    values: z
      .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), fieldValue)
      .refine(
        (values) =>
          Object.keys(values).length > 0 &&
          Object.keys(values).length <= 50 &&
          Object.keys(values).every((key) => !forbiddenFieldKeys.has(key)),
      ),
  }),
  z.strictObject({
    operationType: z.literal('CREATE_FOLLOW_UP'),
    ...target,
    title: z.string().trim().min(1).max(200),
    dueAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    operationType: z.literal('ADD_ACTIVITY_NOTE'),
    ...target,
    content: z.string().trim().min(1).max(4000),
  }),
]);

export type ProposalCandidate = z.infer<typeof candidateSchema>;

/** No actor selectors, extra targets or unknown fields at the untrusted provider boundary. */
export function validateProposalCandidate(input: unknown): ProposalCandidate {
  const parsed = candidateSchema.parse(input);
  if (
    parsed.operationType === 'CREATE_FOLLOW_UP' &&
    Number.isNaN(Date.parse(parsed.dueAt))
  ) {
    throw new z.ZodError([
      { code: 'custom', path: ['dueAt'], message: 'Invalid date' },
    ]);
  }
  return parsed;
}
