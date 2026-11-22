import { z } from 'zod';

const quotation = z.string().min(1).max(4000);
const value = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(300)).max(100),
  z.null(),
]);
const time = z
  .union([
    z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    z.enum(['morning', 'afternoon', 'evening']),
  ])
  .nullable();
const isoDate = z.iso.date();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((text) => isoDate.safeParse(text).success);
const period = z.enum(['this', 'next']);
export const communicationDateExpressionSchema = z.union([
  z.strictObject({ date, kind: z.literal('absolute'), time }),
  z.strictObject({
    days: z.number().int().nonnegative(),
    kind: z.literal('relativeDays'),
    time,
  }),
  z.strictObject({
    week: period,
    kind: z.literal('weekday'),
    weekday: z.number().int().min(1).max(7),
    time,
  }),
  z.strictObject({ month: period, kind: z.literal('monthEnd'), time }),
  z.strictObject({ kind: z.literal('unknown'), time: z.null() }),
]);
export type CommunicationDateExpression = z.infer<
  typeof communicationDateExpressionSchema
>;

// Structured output providers require every key; null and [] represent absent suggestions.
export const communicationWireSchema = z.strictObject({
  note: z.string().trim().min(1).max(4000),
  followUp: z
    .strictObject({
      title: z.string().trim().min(1).max(200),
      dateExpression: communicationDateExpressionSchema,
      evidence: quotation,
    })
    .nullable(),
  fieldChanges: z
    .array(
      z.strictObject({
        fieldKey: z.string().min(1).max(64),
        value,
        evidence: quotation,
      }),
    )
    .max(50),
});
export const communicationOutputSchema = communicationWireSchema.partial({
  followUp: true,
  fieldChanges: true,
});

export type CommunicationProviderInput = {
  text: string;
  now: string;
  timeZone: string;
  fields: {
    fieldKey: string;
    label: string;
    type: string;
    options?: { key: string; label: string }[];
  }[];
  recordContext: unknown;
};
