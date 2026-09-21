import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

export const searchRecordsInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    query: z.string().max(200).optional(),
    filters: z.record(z.string().max(64), z.unknown()).optional(),
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
      'Search records the current actor can read. Limit is 1-20; never pass owner or actor overrides.',
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
