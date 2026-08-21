import {
  isPublishedFieldType,
  type JsonValue,
  type PublishedDataScope,
  type PublishedField,
  type PublishedFieldAccess,
  type PublishedObjectSchema,
} from './object-schema';

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

const TITLE_FIELD_TYPES = new Set<DraftFieldType>([
  'TEXT',
  'PHONE',
  'EMAIL',
  'SINGLE_SELECT',
]);

export function analyzePublication(
  input: PublicationDraft,
): PublicationAnalysis {
  const blocking: PublicationIssue[] = [];
  const activeFields = input.fields.filter(
    (field) => field.status === 'ACTIVE',
  );
  const activeFieldByKey = new Map(
    activeFields.map((field) => [field.fieldKey, field]),
  );
  const titleField = activeFieldByKey.get(input.object.titleFieldKey);

  if (!titleField || !titleField.required) {
    blocking.push({
      code: 'TITLE_FIELD_REQUIRED',
      message: '标题字段必须存在、启用且设为必填。',
      fieldKey: input.object.titleFieldKey,
    });
  }

  if (titleField && !TITLE_FIELD_TYPES.has(titleField.type)) {
    blocking.push({
      code: 'TITLE_FIELD_TYPE_UNSUPPORTED',
      message: '标题字段类型不支持作为记录标题。',
      fieldKey: titleField.fieldKey,
    });
  }

  for (const field of activeFields) {
    if (!isPublishedFieldType(field.type)) {
      blocking.push({
        code: 'FIELD_TYPE_UNSUPPORTED',
        message: '字段类型暂不支持发布。',
        fieldKey: field.fieldKey,
      });
    }

    if (hasDuplicateOptionKeys(field)) {
      blocking.push({
        code: 'FIELD_OPTION_KEY_DUPLICATE',
        message: '选项键必须在字段内保持唯一。',
        fieldKey: field.fieldKey,
      });
    }
  }

  if (!input.defaultView) {
    blocking.push({
      code: 'DEFAULT_VIEW_REQUIRED',
      message: '发布对象前必须配置默认视图。',
    });
  } else {
    for (const fieldKey of input.defaultView.columnFieldKeys) {
      if (!activeFieldByKey.has(fieldKey)) {
        blocking.push({
          code: 'DEFAULT_VIEW_FIELD_INACTIVE',
          message: '默认视图只能引用已启用字段。',
          fieldKey,
        });
      }
    }
  }

  if (!input.employeeAccess) {
    blocking.push({
      code: 'EMPLOYEE_ACCESS_REQUIRED',
      message: '发布对象前必须显式配置员工角色权限。',
    });
  }

  const previousFields = new Map(
    (input.activeSchema?.fields ?? []).map((field) => [field.fieldKey, field]),
  );
  const changes = analyzeFieldChanges(activeFields, previousFields);

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

  return { blocking, warnings: [], changes };
}

export function compilePublication(
  input: PublicationDraft & {
    publication: PublishedObjectSchema['publication'];
  },
): PublishedObjectSchema {
  if (!input.defaultView || !input.employeeAccess) {
    throw new Error('Publication draft is incomplete');
  }

  const fields = input.fields
    .filter((field) => field.status === 'ACTIVE')
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.fieldKey.localeCompare(right.fieldKey),
    )
    .map(toPublishedField);

  return {
    publication: { ...input.publication },
    object: {
      id: input.object.id,
      code: input.object.code,
      name: input.object.name,
      description: input.object.description,
      titleFieldKey: input.object.titleFieldKey,
      icon: input.object.icon,
      sortOrder: input.object.sortOrder,
    },
    fields,
    defaultView: {
      code: 'default',
      name: input.defaultView.name,
      columnFieldKeys: [...input.defaultView.columnFieldKeys],
      sort: { ...input.defaultView.sort },
    },
    employeeAccess: {
      canCreate: input.employeeAccess.canCreate,
      canRead: input.employeeAccess.canRead,
      canUpdate: input.employeeAccess.canUpdate,
      canDelete: false,
      readScope: input.employeeAccess.readScope,
      updateScope: input.employeeAccess.updateScope,
      fields: { ...input.employeeAccess.fields },
    },
  };
}

function toPublishedField(field: PublicationDraftField): PublishedField {
  if (!isPublishedFieldType(field.type)) {
    throw new Error(`Unsupported published field type: ${field.type}`);
  }

  return {
    id: field.id,
    fieldKey: field.fieldKey,
    label: field.label,
    type: field.type,
    required: field.required,
    defaultValue: field.defaultValue,
    validation: { ...field.validation },
    config: { ...field.config },
    sortOrder: field.sortOrder,
    isSystem: field.isSystem,
  };
}

function hasDuplicateOptionKeys(field: PublicationDraftField): boolean {
  if (field.type !== 'SINGLE_SELECT' && field.type !== 'MULTI_SELECT') {
    return false;
  }

  const options = field.config.options;
  if (!Array.isArray(options)) return false;

  const keys = options.flatMap((option) => {
    if (
      option &&
      typeof option === 'object' &&
      !Array.isArray(option) &&
      typeof option.key === 'string'
    ) {
      return [option.key];
    }
    return [];
  });

  return new Set(keys).size !== keys.length;
}

function analyzeFieldChanges(
  activeFields: PublicationDraftField[],
  previousFields: Map<string, PublishedField>,
): PublicationAnalysis['changes'] {
  const changes: PublicationAnalysis['changes'] = [];
  const currentKeys = new Set(activeFields.map((field) => field.fieldKey));

  for (const field of activeFields) {
    const previous = previousFields.get(field.fieldKey);
    if (!previous) {
      changes.push({ kind: 'ADDED', fieldKey: field.fieldKey });
    } else if (isPublishedFieldType(field.type)) {
      const current = toPublishedField(field);
      if (JSON.stringify(current) !== JSON.stringify(previous)) {
        changes.push({ kind: 'UPDATED', fieldKey: field.fieldKey });
      }
    }
  }

  for (const fieldKey of previousFields.keys()) {
    if (!currentKeys.has(fieldKey)) {
      changes.push({ kind: 'INACTIVATED', fieldKey });
    }
  }

  return changes;
}
