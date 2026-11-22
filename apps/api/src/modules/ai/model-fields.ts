import type { ResolvedObjectSchema } from '../objects/published-object.service';
import type { PublishedField } from '../objects/object-schema';
import { queryFields } from '../records/record-filter';
import { selectOptions } from '../records/record-value-engine';
import { allowsProposalFieldKey } from './ai-proposal.schema';
import { AiSanitizer } from './ai-sanitizer';

export function modelFields(
  resolved: ResolvedObjectSchema,
  editable?: Readonly<Record<string, string>>,
) {
  const fields = editable
    ? resolved.schema.fields.filter(
        (field) =>
          editable[field.fieldKey] === 'EDIT' &&
          !field.isSystem &&
          allowsProposalFieldKey(field.fieldKey) &&
          !['workflowStateKey', 'workflow_state_key'].includes(field.fieldKey),
      )
    : queryFields(resolved);
  return fields
    .filter((field) => AiSanitizer.allowsKey(field.fieldKey))
    .map((field) => ({
      field,
      metadata: modelFieldMetadata(field),
    }));
}

function modelFieldMetadata(
  field: Pick<
    PublishedField,
    'fieldKey' | 'label' | 'type' | 'required' | 'config' | 'validation'
  >,
) {
  const { fieldKey, label, type } = field;
  return {
    fieldKey,
    label,
    type,
    ...(type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
      ? {
          options: selectOptions(field)
            .filter((option) => option.status === 'ACTIVE')
            .map(({ key, label }) => ({ key, label })),
        }
      : {}),
  };
}
