import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

const words = new Intl.Segmenter('zh', { granularity: 'word' });

export const FILTER_FORMAT =
  'Filters use at most 8 visible field keys from describe_object. SINGLE_SELECT/MULTI_SELECT: non-empty option key arrays (max 20), e.g. {"stage":["lost"]}, never a scalar or {eq:...}. MEMBER: UUID arrays (max 20). NUMBER/MONEY: {min: number, max: number}, either bound optional. DATE/DATETIME: {from:"YYYY-MM-DD",to:"YYYY-MM-DD"} or {relative:"today"|"this_week"|"this_month"|"past_7_days"|"past_30_days"}. BOOLEAN: true/false. Text: {contains:"text"}. Any field supports {presence:"empty"|"not_empty"}. Never guess hidden fields or options.';

export const searchRecordsInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    query: z.string().optional(),
    filters: z
      .record(z.string().max(64), z.unknown())
      .describe(FILTER_FORMAT)
      .optional(),
    sort: z.string().min(1).max(64).default('updatedAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().default(10),
  })
  .strict();

export function createSearchRecordsTool(
  records: RecordsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'search_records',
    description:
      'Search records the current actor can read. Use page and limit for subsequent pages; the service returns the effective page size. If a compound keyword has no matches, use suggestedQueries for individual searches in the same table with the original filters, unless an exact-only match was requested. Only report broader matches as such; never pass owner or actor overrides. Results are a limited page, never a complete total. ' +
      FILTER_FORMAT,
    inputSchema: searchRecordsInput,
    async execute(input) {
      const parsed = searchRecordsInput.parse(input);
      const result = await records.list(context, parsed.objectCode, {
        page: parsed.page,
        limit: parsed.limit,
        search: parsed.query,
        filters: parsed.filters ? JSON.stringify(parsed.filters) : undefined,
        sort: parsed.sort,
        direction: parsed.direction,
      });
      const keyword = parsed.query?.trim();
      if (result.total === 0 && keyword) {
        const suggestedQueries = [
          ...new Set(
            Array.from(words.segment(keyword))
              .filter((part) => part.isWordLike && part.segment !== keyword)
              .map((part) => part.segment),
          ),
        ];
        if (suggestedQueries.length) return { ...result, suggestedQueries };
      }
      return result;
    },
  };
}
