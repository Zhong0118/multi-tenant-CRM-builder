import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiQuery,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';

import { featureKeys } from './feature-catalog';
export const feature = z.enum(featureKeys);
const catalog = z.array(
  z.strictObject({
    key: feature,
    label: z.string(),
    group: z.string(),
    requires: feature.nullable(),
    purpose: z.string(),
    released: z.boolean(),
    outputLimit: z.int().nullable(),
  }),
);
export const allocation = z.enum(['shared', 'equal']);
const tokens = z
  .string()
  .regex(/^\d+$/)
  .describe('Exact token count in decimal notation');
const quota = tokens.refine(
  (n) => n.length < 19 || (n.length === 19 && n <= '9223372036854775807'),
);
const version = z.number().int().positive();
const planFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  features: z.array(feature),
  monthlyTokens: quota,
  assignable: z.boolean(),
};
const plan = z.strictObject({
  id: z.uuid(),
  ...planFields,
  version,
  companies: z.number().int(),
});
const settingsFields = {
  defaultPlanId: z.uuid().nullable(),
  disabled: z.boolean(),
  reason: z.string().trim().max(500).nullable(),
};
const platformState = z.strictObject({ ...settingsFields, version });
const confirmation = z.string().regex(/^[a-f0-9]{64}$/);
const planEdit = z.strictObject({
  ...planFields,
  replacementDefaultPlanId: z.uuid().nullable().optional(),
});
const planImpact = z.strictObject({
  version,
  companies: z.int(),
  removedFeatures: z.array(feature),
  confirmation,
});
const date = z.iso.date();
const month = date.regex(/^\d{4}-\d\d-01$/);
const tenant = z.strictObject({
  tenantId: z.uuid(),
  name: z.string(),
  code: z.string(),
  month,
  restoresAt: z.string(),
  startedAt: z.string(),
  planId: z.uuid().nullable(),
  planName: z.string().nullable(),
  planVersion: version.nullable(),
  features: z.array(feature),
  allocation,
  version,
  baseTokens: tokens,
  extraTokens: tokens,
  totalTokens: tokens,
  usedTokens: tokens,
  reservedTokens: tokens,
  remainingTokens: tokens,
  percent: z.number().nullable(),
});
const dayUsage = z.strictObject({
  date,
  feature,
  calls: tokens,
  inputTokens: tokens,
  outputTokens: tokens,
  proposals: tokens,
  confirmations: tokens,
});
const member = z.strictObject({
  memberId: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  usedTokens: tokens,
  reservedTokens: tokens,
});
const share = z.strictObject({
  members: z.int(),
  shareTokens: tokens.nullable(),
  overShare: z.int(),
  confirmation,
});
const operation = z.strictObject({
  id: z.uuid(),
  memberId: z.uuid(),
  feature,
  source: z.string(),
  status: z.string(),
  confirmedByMemberId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const change = z.strictObject({
  label: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
});
const operationItem = z.strictObject({
  operationType: z.string(),
  status: z.string(),
  changes: z.array(change),
});
export const inputs = {
  plan: z.strictObject(planFields),
  planEdit,
  savePlan: planEdit.extend({ confirmation }),
  deletePlan: z.strictObject({ version }),
  settings: platformState,
  assign: z.strictObject({ planId: z.uuid().nullable() }),
  saveAssignment: z.strictObject({ planId: z.uuid().nullable(), confirmation }),
  quota: z.strictObject({
    month,
    amount: quota.refine((n) => /[1-9]/.test(n)),
    idempotencyKey: z.string().trim().min(1).max(100),
  }),
  allocation: z.strictObject({ allocation, confirmation }),
  companies: z.strictObject({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().trim().max(200).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  }),
  operations: z.strictObject({
    memberId: z.uuid().optional(),
    from: date.optional(),
    to: date.optional(),
    operationType: z
      .enum(['UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE'])
      .optional(),
    source: z
      .enum(['proposal', 'draft', 'blueprint', 'denial', 'provider'])
      .optional(),
    feature: feature.optional(),
    status: z.string().max(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
};
export const outputs = {
  plan,
  plans: z.array(plan),
  planImpact,
  deleted: z.strictObject({ deleted: z.boolean() }),
  platform: platformState.extend({
    catalog,
    affectedCompanies: z.int(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    configured: z.boolean(),
    anomalies: z.array(
      z.strictObject({
        model: z.string(),
        calls: tokens,
        excessTokens: tokens,
      }),
    ),
  }),
  settings: platformState,
  tenant,
  companies: z.strictObject({
    items: z.array(tenant),
    page: z.int(),
    limit: z.int(),
    total: z.int(),
  }),
  summary: tenant.extend({
    catalog,
    trend: z.array(z.strictObject({ month, usedTokens: tokens })),
    usage: z.array(dayUsage),
  }),
  assignment: z.strictObject({
    name: z.string(),
    planId: z.uuid().nullable(),
    addedFeatures: z.array(feature),
    removedFeatures: z.array(feature),
    totalTokens: tokens,
    confirmation,
  }),
  topUp: z.strictObject({ applied: z.boolean(), month }),
  workspace: tenant.extend({ catalog, disabled: z.boolean(), preview: share }),
  usage: z.strictObject({
    month,
    daily: z.array(dayUsage),
    members: z.array(member),
  }),
  capabilities: z.strictObject({
    features: z.array(feature),
    disabled: z.boolean(),
    allocation,
    restoresAt: z.string(),
    notice: z
      .enum(['company_warning', 'company_exhausted', 'personal'])
      .nullable(),
    percent: z.number().nullable(),
    remainingTokens: tokens.nullable(),
  }),
  operations: z.strictObject({
    items: z.array(operation),
    nextCursor: z.string().nullable(),
  }),
  detail: operation.extend({
    objectId: z.uuid().nullable(),
    objectCode: z.string().nullable(),
    recordId: z.uuid().nullable(),
    requestText: z.string().nullable(),
    items: z.array(operationItem),
    auditId: z.uuid().nullable(),
    requestId: z.string().nullable(),
  }),
};
export function validated<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: {
        [result.error.issues[0]?.path.join('.') || 'input']: ['请核对输入。'],
      },
    });
  return result.data;
}
type ApiSchema = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>[string];
function apiSchema(schema: z.ZodType) {
  const value = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' });
  delete value.$schema;
  return value as ApiSchema;
}
export const response = (schema: z.ZodType) =>
  ApiOkResponse({ schema: apiSchema(schema) });
export const body = (schema: z.ZodType) =>
  ApiBody({ schema: apiSchema(schema) });
export function query(schema: z.ZodObject) {
  const definition = apiSchema(schema) as {
    properties: Record<string, ApiSchema>;
  };
  return applyDecorators(
    ...Object.entries(definition.properties).map(([name, property]) =>
      ApiQuery({ name, required: false, schema: property }),
    ),
  );
}
