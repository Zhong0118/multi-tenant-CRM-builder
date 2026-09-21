import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { PublishedObjectService } from '../../objects/published-object.service';
import type { AiProviderTool } from '../ai-provider';

export const listObjectsInput = z.object({}).strict();

export function createListObjectsTool(
  publishedObjects: PublishedObjectService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'list_objects',
    description:
      'List published CRM objects the current actor can read. Returns only code and name.',
    inputSchema: listObjectsInput,
    async execute(input) {
      listObjectsInput.parse(input);
      const objects = await publishedObjects.listAccessible(context);
      return objects.map((object) => ({ code: object.code, name: object.name }));
    },
  };
}
