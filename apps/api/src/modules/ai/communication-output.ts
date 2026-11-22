import { z } from 'zod';

const quotation = z.string().min(1).max(4000);
const value = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(300)).max(100),
  z.null(),
]);
// Structured output providers require every key; null and [] represent absent suggestions.
export const communicationWireSchema = z.strictObject({
  note: z.string().trim().min(1).max(4000),
  followUp: z
    .strictObject({
      title: z.string().trim().min(1).max(200),
      suggestedDate: z.string().max(100).nullable(),
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
