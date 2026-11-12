import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { FollowUpsService } from '../../follow-ups/follow-ups.service';
import type { AiProviderTool } from '../ai-provider';

export const listFollowupsInput = z
  .object({
    status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
    dueFrom: z.string().max(64).optional(),
    dueTo: z.string().max(64).optional(),
    objectCode: z.string().min(1).max(64).optional(),
    recordId: z.string().uuid().optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().default(20),
  })
  .strict();

export function createListFollowupsTool(
  followUps: FollowUpsService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'list_followups',
    description:
      "List the current actor's own follow-ups on records they can still read. Use numbered pages (starting at 1), up to 1000 per page, until the page is short; never pass an assignee. dueAt is UTC. dueAtLocal uses the company timezone, except historical offsets with second precision retain UTC ending in Z; label those fallback values UTC. timezone always identifies the company zone. Date filters must include the correct UTC offset for the target date.",
    inputSchema: listFollowupsInput,
    async execute(input) {
      const parsed = listFollowupsInput.parse(input);
      return followUps.listForAi(context, {
        ...parsed,
        limit: Math.min(parsed.limit, 1000),
      });
    },
  };
}
