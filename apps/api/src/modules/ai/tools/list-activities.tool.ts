import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

export const listActivitiesInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    recordId: z.string().uuid(),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().default(20),
  })
  .strict();

export function createListActivitiesTool(
  records: RecordsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'list_activities',
    description:
      'List activities on a record the current actor can already read. Use page and limit to read older activities.',
    inputSchema: listActivitiesInput,
    async execute(input) {
      const { objectCode, recordId, page, limit } =
        listActivitiesInput.parse(input);
      return records.listActivities(context, objectCode, recordId, {
        page,
        limit,
      });
    },
  };
}
