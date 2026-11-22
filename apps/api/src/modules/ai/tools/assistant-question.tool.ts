import { z } from 'zod';
import type { AiProviderTool } from '../ai-provider';
import { OBJECT_CODE_REFERENCE_PATTERN } from '../../objects/object-code';

const plainText = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !/(?:[<>\p{Cc}`*[\]]|(?:https?:|www\.|mailto:|javascript:|\/workspaces?\/)|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b)/iu.test(
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
  z
    .strictObject({
      kind: z.literal('fill_fields'),
      mode: z.enum(['missing', 'pick_any']),
      prompt,
      objectCode,
      recordId: z.uuid(),
      fieldKeys: z
        .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/))
        .max(50)
        .refine(distinct),
    })
    .refine((input) => input.mode === 'pick_any' || input.fieldKeys.length > 0),
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
  mode: form.shape.mode.optional(),
});
export type QuestionInput = z.infer<typeof questionInput>;
export function createQuestionTools(
  open: (input: QuestionInput) => Promise<unknown>,
): AiProviderTool[] {
  return [
    {
      name: 'ask_user',
      description:
        'Pause and ask one question. choose_record uses record IDs actually returned by read tools. When two or more approaches are possible, use choose_option with 2–4 distinct plain-text choices instead of asking in chat. For a seen record, “帮我改一下” or an unspecified edit needs fill_fields with mode pick_any: the user may fill any one or more named editable fields (fieldKeys: [] offers all). When the requested change needs specific missing values, use mode missing and list only the editable keys that must all be filled.',
      inputSchema: providerInput,
      async execute(raw) {
        return open(questionInput.parse(raw));
      },
    },
  ];
}
