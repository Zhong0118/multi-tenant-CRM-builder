import {
  FILTER_FIELD_OPERATORS,
  FILTER_OPERATORS,
  RELATIVE_DATE_PRESETS,
} from '@crm/contracts';
import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

const words = new Intl.Segmenter('zh', { granularity: 'word' });

export const FILTER_FORMAT = [
  'Use {version:1,match:"all"|"any",conditions:[{fieldKey,operator,value?}]} with visible fields from describe_object. Groups may nest up to 3 levels, 16 leaves total.',
  Object.entries(FILTER_FIELD_OPERATORS)
    .map(([type, operators]) => type + ': ' + operators.join('|'))
    .join('; '),
  Object.entries(FILTER_OPERATORS)
    .map(([operator, entry]) => operator + '=' + entry.valueShape)
    .join(', '),
  'Lists are 1–20 active keys or member UUIDs/$me. Dates are YYYY-MM-DD, MONEY uses decimal strings, ranges use {from,to}, none omits value. Relative: ' +
    RELATIVE_DATE_PRESETS.join('|') +
    '.',
  '$owner uses OWNER. $followUp uses FOLLOW_UP, optionally {assignee:"$me"|"any"}; defaults to own OPEN follow-ups due through today. Legacy flat filters such as {"stage":["lost"]} are also accepted.',
].join(' ');

export const searchRecordsInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    viewId: z.uuid().optional(),
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
        ...(parsed.viewId ? { viewId: parsed.viewId } : {}),
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
