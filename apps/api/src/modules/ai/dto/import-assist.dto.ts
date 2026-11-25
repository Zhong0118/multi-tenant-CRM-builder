import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import type { ImportAssistRequest } from '@crm/contracts';

const text = z.string().max(4096);
const fieldTarget = z.strictObject({
  mode: z.enum(['field', 'append']),
  field: z.string().min(1).max(128),
});
const position = z.string().regex(/^C(?:[1-9]|[1-3]\d|40)$/);
const column = z.strictObject({
  col: position,
  headerHash: z.string().regex(/^[0-9a-f]{64}$/),
  header: text,
  samples: z.array(text).max(5),
  excluded: z.boolean().optional(),
  locked: z
    .union([fieldTarget, z.strictObject({ mode: z.enum(['owner', 'skip']) })])
    .optional(),
  values: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-zA-Z0-9:_-]{1,64}$/),
        text,
        count: z.number().int().min(1).max(10000),
      }),
    )
    .max(50)
    .optional(),
});
export const importRequestSchema = z.strictObject({
  sheet: text,
  columns: z.array(column).min(1).max(40),
});
export const confidence = z.enum(['high', 'review']);
export const valueAdvice = z.strictObject({
  value: z.string(),
  option: z.string().nullable(),
  confidence,
});
export const columnAdvice = z.strictObject({
  col: z.string(),
  target: z.union([fieldTarget, z.strictObject({ mode: z.literal('skip') })]),
  confidence,
  reason: z.string(),
  dateOrder: z.enum(['DMY', 'MDY']).optional(),
  bareAmountUnit: z.enum(['yuan', 'wan']).optional(),
  values: z.array(valueAdvice).optional(),
});
export const importPlanSchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  columns: z.array(columnAdvice),
  matchFields: z.array(z.string()).max(3),
});

function unique(items: string[] | number[]) {
  return new Set<string | number>(items).size === items.length;
}
export function parseImportRequest(raw: unknown): ImportAssistRequest {
  const invalid = () => new ApiException('VALIDATION_FAILED', 400);
  if (Buffer.byteLength(JSON.stringify(raw) ?? '') > 80 * 1024) throw invalid();
  const parsed = importRequestSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const { columns } = parsed.data;
  if (
    !unique(columns.map((c) => c.col)) ||
    columns.some((c) => c.values && !unique(c.values.map((v) => v.id)))
  )
    throw invalid();
  return parsed.data;
}
