import { z } from 'zod';

import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { JsonValue } from '../../objects/object-schema';
import type { PublishedObjectService } from '../../objects/published-object.service';
import type { AiProviderTool } from '../ai-provider';

export const describeObjectInput = z
  .object({
    objectCode: z.string().min(1).max(64),
  })
  .strict();

export function createDescribeObjectTool(
  publishedObjects: PublishedObjectService,
  context: TenantContext,
): AiProviderTool {
  return {
    name: 'describe_object',
    description:
      'Describe visible fields of a published CRM object the current actor can read.',
    inputSchema: describeObjectInput,
    async execute(input) {
      const { objectCode } = describeObjectInput.parse(input);
      const resolved = await publishedObjects.resolveRuntimeSchema(
        context,
        objectCode,
      );
      return {
        object: {
          code: resolved.visibleSchema.object.code,
          name: resolved.visibleSchema.object.name,
        },
        fields: resolved.visibleSchema.fields.map(projectVisibleField),
      };
    },
  };
}

function projectVisibleField(field: {
  fieldKey: string;
  label: string;
  type: string;
  required: boolean;
  config: Record<string, JsonValue>;
}) {
  const projected = {
    fieldKey: field.fieldKey,
    label: field.label,
    type: field.type,
    required: field.required,
  };
  const options = projectOptions(field.config.options);
  return options ? { ...projected, options } : projected;
}

function projectOptions(value: JsonValue | undefined) {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((option) => {
    if (
      !option ||
      typeof option !== 'object' ||
      Array.isArray(option) ||
      typeof option.key !== 'string' ||
      typeof option.label !== 'string'
    ) {
      return [];
    }
    if (option.status === 'INACTIVE') return [];
    return [{ key: option.key, label: option.label }];
  });
  return options.length > 0 ? options : undefined;
}
