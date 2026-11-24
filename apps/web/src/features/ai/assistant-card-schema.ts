import {
  parseFilterRule,
  type AssistantAction,
  type AssistantQuestion,
} from "@crm/contracts";
import { writingOptionsSchema, liveWritingSchema } from "./sales-draft-api";
import { z } from "zod";

const text = z.string().min(1);
const choice = z.object({
  id: text,
  label: text,
  summary: z.string().optional(),
});
export const assistantFields = z
  .array(
    z.object({
      key: text,
      label: text,
      type: text,
      options: z.array(choice).optional(),
      requiredForAnswer: z.boolean().optional(),
      value: z.unknown().optional(),
    }),
  )
  .max(50);
const answers = z.union([
  z.object({ kind: z.literal("choose_record"), optionId: text }),
  z.object({ kind: z.literal("choose_option"), optionId: text }),
  z.object({ kind: z.literal("choose_option"), otherText: text.max(4000) }),
  z.object({
    kind: z.literal("fill_fields"),
    values: z.record(text, z.unknown()),
  }),
]);
const base = z.object({
  questionId: text,
  turnId: text,
  state: z.enum(["OPEN", "ANSWERED", "SUPERSEDED", "CANCELLED", "EXPIRED"]),
  prompt: text,
  answer: answers.nullish().transform((value) => value ?? undefined),
});
export const questionSchema: z.ZodType<AssistantQuestion> =
  z.discriminatedUnion("kind", [
    base.extend({ kind: z.literal("choose_record"), options: z.array(choice) }),
    base.extend({ kind: z.literal("choose_option"), options: z.array(choice) }),
    base.extend({ kind: z.literal("fill_fields"), fields: assistantFields }),
  ]);
const rule = z.unknown().transform(parseFilterRule);
export const actionSchema: z.ZodType<AssistantAction> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("writing"),
      objectCode: text,
      recordId: text,
      options: writingOptionsSchema,
      draft: liveWritingSchema.optional(),
    }),
    z.object({
      kind: z.literal("communication"),
      draftId: text,
      objectCode: text,
      recordId: text,
    }),
    z.object({
      kind: z.literal("filter"),
      objectCode: text,
      baseViewId: text.optional(),
      currentRule: rule,
      preview: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("rule"), rule }),
        z.object({
          kind: z.literal("clarify"),
          options: z.array(z.object({ id: text, label: text, value: rule })),
        }),
        z.object({ kind: z.literal("unavailable") }),
      ]),
    }),
  ],
);
