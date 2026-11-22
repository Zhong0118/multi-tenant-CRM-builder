import {
  FILTER_OPERATORS,
  type FilterOperator,
  type FilterRule,
} from '@crm/contracts';
import { Prisma } from '@crm/database';
import { z } from 'zod';

export interface FilterModelField {
  fieldKey: string;
  label: string;
  type: string;
  operators: readonly FilterOperator[];
  options?: { key: string; label: string }[];
}

export interface FilterProviderInput {
  text: string;
  currentRule: FilterRule;
  fields: FilterModelField[];
  relativeDates: readonly string[];
  followUpAssignees: string[];
  today: string;
}

// All wire keys are required by strict providers. A presence test uses null on
// the wire; the CRM contract omits its value.
const scalar = z.union([z.number(), z.string()]);
const condition = z.strictObject({
  fieldKey: z.string(),
  operator: z.enum(
    Object.keys(FILTER_OPERATORS) as [FilterOperator, ...FilterOperator[]],
  ),
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.array(z.string()),
    z.strictObject({ from: scalar, to: scalar }),
    z.strictObject({ assignee: z.enum(['$me', 'any']) }),
    z.null(),
  ]),
});
const group = z.strictObject({
  match: z.enum(['all', 'any']),
  conditions: z.array(condition).max(16),
});
export const filterWireSchema = z.strictObject({
  rules: z.array(group.extend({ version: z.literal(1) })).max(4),
});

export const filterModelSchema = group.extend({
  conditions: z.array(z.union([condition, group])).max(16),
  clarification: z
    .strictObject({
      phrase: z.string(),
      interpretations: z.array(z.array(condition).min(1).max(16)).min(2).max(4),
    })
    .nullable(),
});

// A provider may quote a NUMBER because the wire type also covers exact MONEY
// decimals. Leave malformed or lossy values for the record validator to reject.
function numberBound(value: string | number) {
  if (
    typeof value !== 'string' ||
    value.length > 400 ||
    !/^-?\d+(?:\.\d+)?$/.test(value)
  )
    return value;
  const number = Number(value);
  return Number.isFinite(number) &&
    new Prisma.Decimal(value).equals(String(number))
    ? number
    : value;
}

export function editableFilterRules(
  output: z.infer<typeof filterModelSchema>,
  text: string,
  fields: readonly FilterModelField[] = [],
) {
  const { match, clarification } = output;
  function normalize(term: z.infer<typeof condition>) {
    if (fields.find((f) => f.fieldKey === term.fieldKey)?.type !== 'NUMBER')
      return term;
    const { value } = term;
    if (typeof value === 'string')
      return { ...term, value: numberBound(value) };
    if (value && typeof value === 'object' && 'from' in value)
      return {
        ...term,
        value: { from: numberBound(value.from), to: numberBound(value.to) },
      };
    return term;
  }
  const conditions: z.infer<typeof condition>[] = [];
  for (const term of output.conditions) {
    if ('conditions' in term) return { rules: [] };
    conditions.push(normalize(term));
  }
  const base = { version: 1 as const, match, conditions };
  if (!clarification) return { rules: conditions.length ? [base] : [] };
  const phrase = clarification.phrase.trim();
  if (!phrase || !text.includes(phrase)) return { rules: [] };
  return {
    rules: clarification.interpretations.map((terms) => ({
      ...base,
      conditions: [...conditions, ...terms.map(normalize)],
    })),
  };
}
