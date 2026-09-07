import {
  type JsonValue,
  type PublishedDataScope,
  type PublishedField,
  type PublishedFieldAccess,
  type PublishedObjectSchema,
} from './object-schema';
import {
  analyzeObjectConfiguration,
  compileObjectConfiguration,
} from './object-configuration.policy';

export type DraftFieldType = PublishedField['type'] | 'ATTACHMENT';

export interface PublicationDraftField {
  id: string;
  fieldKey: string;
  label: string;
  type: DraftFieldType;
  required: boolean;
  defaultValue: JsonValue;
  validation: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
  sortOrder: number;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  updatedAt?: string;
}

export interface PublicationDraft {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
    version: number;
    updatedAt?: string;
  };
  fields: PublicationDraftField[];
  defaultView: {
    code: 'default';
    name: string;
    columnFieldKeys: string[];
    /**
     * Extra JSONB fields included in keyword search. Missing means the
     * publication still uses visible default-view text columns. An empty
     * array means title-only search.
     */
    searchFieldKeys?: string[];
    sort: {
      field: 'updatedAt' | 'createdAt' | 'recordNo';
      direction: 'asc' | 'desc';
    };
    updatedAt?: string;
  } | null;
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
    fields: Record<string, PublishedFieldAccess>;
    memberOverrides?: Record<string, unknown>;
  } | null;
  activeSchema: PublishedObjectSchema | null;
  activeRecordCount: number;
  missingRequiredValueCounts?: Record<string, number>;
}

export interface PublicationIssue {
  code: string;
  message: string;
  fieldKey?: string;
}

export interface PublicationAnalysis {
  blocking: PublicationIssue[];
  warnings: PublicationIssue[];
  changes: Array<{
    kind: 'ADDED' | 'UPDATED' | 'INACTIVATED';
    fieldKey: string;
  }>;
}

export function analyzePublication(
  input: PublicationDraft,
): PublicationAnalysis {
  const activeFields = input.fields.filter(
    (field) => field.status === 'ACTIVE',
  );
  const configuration = analyzeObjectConfiguration({
    object: input.object,
    fields: input.fields,
    defaultView: input.defaultView,
    employeeAccess: input.employeeAccess,
    previousFields: input.activeSchema?.fields,
  });
  const blocking = [...configuration.blocking];
  const previousFields = new Map(
    (input.activeSchema?.fields ?? []).map((field) => [field.fieldKey, field]),
  );

  for (const field of activeFields) {
    const previous = previousFields.get(field.fieldKey);
    const newlyRequired = field.required && (!previous || !previous.required);
    const missingCount = input.missingRequiredValueCounts?.[field.fieldKey];
    const cannotProveExistingRecordsHaveValues =
      input.activeRecordCount > 0 && missingCount === undefined;

    if (
      newlyRequired &&
      input.activeRecordCount > 0 &&
      (cannotProveExistingRecordsHaveValues || (missingCount ?? 0) > 0)
    ) {
      blocking.push({
        code: 'REQUIRED_FIELD_HAS_MISSING_VALUES',
        message: '现有记录缺少该字段值，暂时不能发布为必填字段。',
        fieldKey: field.fieldKey,
      });
    }
  }

  return {
    blocking,
    warnings: configuration.warnings,
    changes: configuration.changes,
  };
}

export function compilePublication(
  input: PublicationDraft & {
    publication: PublishedObjectSchema['publication'];
  },
): PublishedObjectSchema {
  if (!input.defaultView || !input.employeeAccess) {
    throw new Error('Publication draft is incomplete');
  }

  const configuration = compileObjectConfiguration({
    ...input,
    defaultView: input.defaultView,
    employeeAccess: input.employeeAccess,
  });

  return {
    publication: { ...input.publication },
    ...configuration,
  };
}
