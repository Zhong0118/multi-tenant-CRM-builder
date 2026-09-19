import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

export const aggregateRecordsInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    filters: z.record(z.string().max(64), z.unknown()).optional(),
    aggregation: z.enum(['COUNT', 'SUM', 'AVG']),
    valueFieldKey: z.string().min(1).max(64).optional(),
    groupByFieldKey: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(20).default(20),
  })
  .strict();

export function createAggregateRecordsTool(
  records: RecordsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'aggregate_records',
    description:
      'Aggregate records the current actor can read. COUNT/SUM/AVG only; group limit is 1-20.',
    inputSchema: aggregateRecordsInput,
    async execute(input) {
      const parsed = aggregateRecordsInput.parse(input);
      return records.aggregate(context, parsed.objectCode, {
        filters: parsed.filters,
        aggregation: parsed.aggregation,
        valueFieldKey: parsed.valueFieldKey,
        groupByFieldKey: parsed.groupByFieldKey,
        limit: parsed.limit,
      });
    },
  };
}
