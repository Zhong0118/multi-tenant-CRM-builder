import { z } from 'zod';
import type { AiProviderTool } from '../ai-provider';
import { OBJECT_CODE_REFERENCE_PATTERN } from '../../objects/object-code';

const plainText = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !/(?:[<>\x00-\x1f\x7f`*\[\]]|(?:https?:|www\.|mailto:|javascript:|\/workspaces?\/)|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b)/i.test(
        value,
      ),
  );
const prompt = plainText.max(240).optional();
const objectCode = z.string().regex(OBJECT_CODE_REFERENCE_PATTERN);
const distinct = (values: string[]) => new Set(values).size === values.length;
export const questionInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('choose_record'),
    prompt,
    objectCode,
    recordIds: z.array(z.uuid()).min(1).max(20).refine(distinct),
  }),
  z.strictObject({
    kind: z.literal('choose_option'),
    prompt,
    options: z
      .array(plainText.max(40).refine((v) => v !== '其他'))
      .min(2)
      .max(4)
      .refine(distinct),
  }),
  z.strictObject({
    kind: z.literal('fill_fields'),
    prompt,
    objectCode,
    recordId: z.uuid(),
    fieldKeys: z
      .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/))
      .max(50)
      .refine(distinct),
  }),
]);
const [record, choice, form] = questionInput.options;
// Function APIs require a single object at the schema root.
const providerInput = z.strictObject({
  kind: z.enum(['choose_record', 'choose_option', 'fill_fields']),
  prompt,
  objectCode: objectCode.optional(),
  recordIds: record.shape.recordIds.optional(),
  options: choice.shape.options.optional(),
  recordId: form.shape.recordId.optional(),
  fieldKeys: form.shape.fieldKeys.optional(),
});
export type QuestionInput = z.infer<typeof questionInput>;
export function createQuestionTools(
  open: (input: QuestionInput) => Promise<unknown>,
): AiProviderTool[] {
  return [
    {
      name: 'ask_user',
      description:
        'Pause and ask one question. choose_record uses record IDs actually returned by read tools. choose_option offers 2–4 distinct plain-text intentions. fill_fields requests editable field keys for a seen target (empty array lets the user choose).',
      inputSchema: providerInput,
      async execute(raw) {
        return open(questionInput.parse(raw));
      },
    },
  ];
}
