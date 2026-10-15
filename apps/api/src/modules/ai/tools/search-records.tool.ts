import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

export const FILTER_FORMAT =
  'Filters use at most 8 visible field keys from describe_object. SINGLE_SELECT/MULTI_SELECT: non-empty option key arrays (max 20), e.g. {"stage":["lost"]}, never a scalar or {eq:...}. MEMBER: UUID arrays (max 20). NUMBER/MONEY: {min: number, max: number}, either bound optional. DATE/DATETIME: {from:"YYYY-MM-DD",to:"YYYY-MM-DD"} or {relative:"today"|"this_week"|"this_month"|"past_7_days"|"past_30_days"}. BOOLEAN: true/false. Text: {contains:"text"}. Any field supports {presence:"empty"|"not_empty"}. Never guess hidden fields or options.';

export const searchRecordsInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    query: z.string().max(200).optional(),
    filters: z
      .record(z.string().max(64), z.unknown())
      .describe(FILTER_FORMAT)
      .optional(),
    sort: z.string().min(1).max(64).default('updatedAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export function createSearchRecordsTool(
  records: RecordsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'search_records',
    description:
      'Search records the current actor can read. Limit is 1-20; never pass owner or actor overrides. Results are a limited page, never a complete total. ' +
      FILTER_FORMAT,
    inputSchema: searchRecordsInput,
    async execute(input) {
      const parsed = searchRecordsInput.parse(input);
      return records.list(context, parsed.objectCode, {
        page: 1,
        limit: parsed.limit,
        search: parsed.query,
        filters: parsed.filters ? JSON.stringify(parsed.filters) : undefined,
        sort: parsed.sort,
        direction: parsed.direction,
      });
    },
  };
}
