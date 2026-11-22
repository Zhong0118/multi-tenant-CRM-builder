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
export const filterWireSchema = z.strictObject({
  rules: z
    .array(
      z.strictObject({
        version: z.literal(1),
        match: z.enum(['all', 'any']),
        conditions: z.array(condition).max(16),
      }),
    )
    .max(4),
});
