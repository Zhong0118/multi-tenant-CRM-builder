import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { RecordsService } from '../../records/records.service';
import type { AiProviderTool } from '../ai-provider';

export const getRecordInput = z
  .object({
    objectCode: z.string().min(1).max(64),
    recordId: z.string().uuid(),
  })
  .strict();

export function createGetRecordTool(
  records: RecordsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'get_record',
    description:
      'Get one record the current actor can read. Knowing a UUID is not access.',
    inputSchema: getRecordInput,
    async execute(input) {
      const { objectCode, recordId } = getRecordInput.parse(input);
      return records.detail(context, objectCode, recordId);
    },
  };
}
