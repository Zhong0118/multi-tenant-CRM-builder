import {
  FILTER_OPERATORS,
  type FilterOperator,
  type FilterRule,
} from '@crm/contracts';
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

export function editableFilterRules(
  output: z.infer<typeof filterModelSchema>,
  text: string,
) {
  const { match, clarification } = output;
  const conditions: z.infer<typeof condition>[] = [];
  for (const term of output.conditions) {
    if ('conditions' in term) return { rules: [] };
    conditions.push(term);
  }
  const base = { version: 1 as const, match, conditions };
  if (!clarification) return { rules: conditions.length ? [base] : [] };
  const phrase = clarification.phrase.trim();
  if (!phrase || !text.includes(phrase)) return { rules: [] };
  return {
    rules: clarification.interpretations.map((terms) => ({
      ...base,
      conditions: [...conditions, ...terms],
    })),
  };
}
