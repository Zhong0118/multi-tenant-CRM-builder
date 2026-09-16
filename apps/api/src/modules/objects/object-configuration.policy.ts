import {
  isPublishedFieldType,
  isSearchableFieldType,
  type PublishedField,
  type PublishedObjectSchema,
} from './object-schema';
import type {
  PublicationDraft,
  PublicationDraftField,
  PublicationIssue,
} from './object-publication.policy';

const TITLE_FIELD_TYPES = new Set<PublicationDraftField['type']>([
  'TEXT',
  'PHONE',
  'EMAIL',
  'SINGLE_SELECT',
]);

const VALIDATION_KEYS_BY_FIELD_TYPE: Partial<
  Record<PublicationDraftField['type'], readonly string[]>
> = {
  TEXT: ['minLength', 'maxLength'],
  TEXTAREA: ['minLength', 'maxLength'],
  PHONE: ['minLength', 'maxLength', 'country'],
  NUMBER: ['min', 'max', 'scale'],
  MONEY: ['min', 'max', 'scale'],
};

export interface ObjectConfigurationDraft {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: PublicationDraftField[];
  defaultView: PublicationDraft['defaultView'];
  employeeAccess: PublicationDraft['employeeAccess'];
  previousFields?: PublishedField[];
}

export interface CompleteObjectConfigurationDraft extends ObjectConfigurationDraft {
  defaultView: NonNullable<ObjectConfigurationDraft['defaultView']>;
  employeeAccess: NonNullable<ObjectConfigurationDraft['employeeAccess']>;
}

export interface ObjectConfigurationAnalysis {
  blocking: PublicationIssue[];
  warnings: PublicationIssue[];
  changes: Array<{
    kind: 'ADDED' | 'UPDATED' | 'INACTIVATED';
    fieldKey: string;
  }>;
}

export interface ObjectConfigurationSnapshot {
  object: Omit<PublishedObjectSchema['object'], 'id'> & { id: string };
  fields: PublishedField[];
  defaultView: PublishedObjectSchema['defaultView'];
  employeeAccess: PublishedObjectSchema['employeeAccess'];
}

export function analyzeObjectConfiguration(
  input: ObjectConfigurationDraft,
): ObjectConfigurationAnalysis {
  const blocking: PublicationIssue[] = [];
  const activeFields = input.fields.filter(
    (field) => field.status === 'ACTIVE',
  );
  const activeFieldByKey = new Map(
    activeFields.map((field) => [field.fieldKey, field]),
  );
  const titleField = activeFieldByKey.get(input.object.titleFieldKey);

  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.object.code)) {
    blocking.push({
      code: 'OBJECT_CODE_INVALID',
      message:
        '业务对象代码仅支持小写字母、数字和单个连字符，且必须以字母开头。',
    });
  }

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

    if (
      !Object.hasOwn(field, 'defaultValue') ||
      !isJsonValue(field.defaultValue)
    ) {
      blocking.push({
        code: 'FIELD_DEFAULT_VALUE_INVALID',
        message: '字段默认值必须显式提供有效 JSON 值或 null。',
        fieldKey: field.fieldKey,
      });
    }

    const validationInvalid = hasInvalidValidation(field);
    if (validationInvalid) {
      blocking.push({
        code: 'FIELD_VALIDATION_INVALID',
        message: '字段校验配置包含无效的值或范围。',
        fieldKey: field.fieldKey,
      });
    } else if (hasIncompatibleValidation(field)) {
      blocking.push({
        code: 'FIELD_VALIDATION_INCOMPATIBLE',
        message: '字段校验配置与字段类型不匹配。',
        fieldKey: field.fieldKey,
      });
    }

    const configInvalid = hasInvalidConfig(field);
    if (configInvalid) {
      blocking.push({
        code: 'FIELD_CONFIG_INVALID',
        message: '字段显示配置或选项结构不完整。',
        fieldKey: field.fieldKey,
      });
    } else if (hasDuplicateOptionKeys(field)) {
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
    for (const fieldKey of input.defaultView.searchFieldKeys ?? []) {
      const field = activeFieldByKey.get(fieldKey);
      if (!field) {
        blocking.push({
          code: 'SEARCH_FIELD_INACTIVE',
          message: '搜索字段只能引用已启用字段。',
          fieldKey,
        });
        continue;
      }
      if (!isSearchableFieldType(field.type)) {
        blocking.push({
          code: 'SEARCH_FIELD_TYPE_UNSUPPORTED',
          message: '搜索字段仅支持文本、长文本、电话和邮箱。',
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
  } else {
    for (const field of activeFields) {
      if (!Object.hasOwn(input.employeeAccess.fields, field.fieldKey)) {
        blocking.push({
          code: 'EMPLOYEE_FIELD_ACCESS_REQUIRED',
          message: '每个已启用字段都必须配置员工字段权限。',
          fieldKey: field.fieldKey,
        });
      }

      // A required field the employee cannot see is unfillable, so the object
      // can never be created for them. The `defaultValue == null` carve-out is
      // deliberate: a non-null default is materialized on create, which makes
      // the same configuration legitimate.
      if (
        field.required &&
        input.employeeAccess.fields[field.fieldKey] === 'HIDDEN' &&
        field.defaultValue == null
      ) {
        blocking.push({
          code: 'REQUIRED_FIELD_HIDDEN',
          message: `必填字段「${field.label}」对员工隐藏且没有默认值，员工无法填写，记录将无法创建。请改为可见、取消必填或设置默认值。`,
          fieldKey: field.fieldKey,
        });
      }
    }
  }

  return {
    blocking,
    warnings: [],
    changes: analyzeFieldChanges(activeFields, input.previousFields ?? []),
  };
}

export function compileObjectConfiguration(
  input: CompleteObjectConfigurationDraft,
): ObjectConfigurationSnapshot {
  const activeFields = input.fields.filter(
    (field) => field.status === 'ACTIVE',
  );
  return {
    object: {
      id: input.object.id,
      code: input.object.code,
      name: input.object.name,
      description: input.object.description,
      titleFieldKey: input.object.titleFieldKey,
      icon: input.object.icon,
      sortOrder: input.object.sortOrder,
    },
    fields: activeFields
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.fieldKey.localeCompare(right.fieldKey),
      )
      .map(toPublishedField),
    defaultView: {
      code: 'default',
      name: input.defaultView.name,
      columnFieldKeys: [...input.defaultView.columnFieldKeys],
      ...(input.defaultView.searchFieldKeys === undefined
        ? {}
        : {
            searchFieldKeys: [...input.defaultView.searchFieldKeys],
          }),
      sort: { ...input.defaultView.sort },
    },
    employeeAccess: {
      canCreate: input.employeeAccess.canCreate,
      canRead: input.employeeAccess.canRead,
      canUpdate: input.employeeAccess.canUpdate,
      canDelete: false,
      readScope: input.employeeAccess.readScope,
      updateScope: input.employeeAccess.updateScope,
      fields: Object.fromEntries(
        activeFields.map((field) => [
          field.fieldKey,
          input.employeeAccess.fields[field.fieldKey],
        ]),
      ),
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

function hasInvalidValidation(field: PublicationDraftField): boolean {
  if (!isPlainRecord(field.validation)) return true;
  const validation = field.validation;
  const minLength = validation.minLength;
  const maxLength = validation.maxLength;
  const min = validation.min;
  const max = validation.max;
  const scale = validation.scale;
  const country = validation.country;

  if (
    (minLength !== undefined &&
      (typeof minLength !== 'number' ||
        !Number.isInteger(minLength) ||
        minLength < 0)) ||
    (maxLength !== undefined &&
      (typeof maxLength !== 'number' ||
        !Number.isInteger(maxLength) ||
        maxLength < 1 ||
        maxLength > 10_000)) ||
    (typeof minLength === 'number' &&
      typeof maxLength === 'number' &&
      minLength > maxLength) ||
    (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min))) ||
    (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max))) ||
    (typeof min === 'number' && typeof max === 'number' && min > max) ||
    (scale !== undefined &&
      (typeof scale !== 'number' ||
        !Number.isInteger(scale) ||
        scale < 0 ||
        scale > 12)) ||
    (country !== undefined &&
      (typeof country !== 'string' ||
        country.length === 0 ||
        country.length > 16))
  ) {
    return true;
  }

  return false;
}

function hasInvalidConfig(field: PublicationDraftField): boolean {
  if (!isPlainRecord(field.config)) return true;
  const config = field.config;
  if (
    Object.keys(config).some(
      (key) => !['options', 'help', 'placeholder'].includes(key),
    ) ||
    !isOptionalDisplayText(config.help) ||
    !isOptionalDisplayText(config.placeholder)
  ) {
    return true;
  }

  if (config.options === undefined) return false;
  if (field.type !== 'SINGLE_SELECT' && field.type !== 'MULTI_SELECT') {
    return true;
  }
  if (!Array.isArray(config.options)) return true;
  return config.options.some(
    (option) =>
      !isPlainRecord(option) ||
      Object.keys(option).some(
        (key) => !['key', 'label', 'status', 'color'].includes(key),
      ) ||
      typeof option.key !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(option.key) ||
      option.key.length > 64 ||
      typeof option.label !== 'string' ||
      option.label.trim().length === 0 ||
      option.label.length > 100 ||
      (option.status !== undefined &&
        option.status !== 'ACTIVE' &&
        option.status !== 'INACTIVE') ||
      (option.color !== undefined &&
        ![
          'GRAY',
          'BLUE',
          'CYAN',
          'GREEN',
          'YELLOW',
          'ORANGE',
          'RED',
          'PURPLE',
        ].includes(option.color as string)),
  );
}

function isOptionalDisplayText(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'string' && value.length <= 1000)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function hasIncompatibleValidation(field: PublicationDraftField): boolean {
  const allowedKeys = VALIDATION_KEYS_BY_FIELD_TYPE[field.type] ?? [];
  return Object.keys(field.validation).some(
    (key) => !allowedKeys.includes(key),
  );
}

function analyzeFieldChanges(
  activeFields: PublicationDraftField[],
  previousFields: PublishedField[],
): ObjectConfigurationAnalysis['changes'] {
  const previousFieldsByKey = new Map(
    previousFields.map((field) => [field.fieldKey, field]),
  );
  const changes: ObjectConfigurationAnalysis['changes'] = [];
  const currentKeys = new Set(activeFields.map((field) => field.fieldKey));

  for (const field of activeFields) {
    const previous = previousFieldsByKey.get(field.fieldKey);
    if (!previous) {
      changes.push({ kind: 'ADDED', fieldKey: field.fieldKey });
    } else if (isPublishedFieldType(field.type)) {
      const current = toPublishedField(field);
      if (JSON.stringify(current) !== JSON.stringify(previous)) {
        changes.push({ kind: 'UPDATED', fieldKey: field.fieldKey });
      }
    }
  }

  for (const fieldKey of previousFieldsByKey.keys()) {
    if (!currentKeys.has(fieldKey)) {
      changes.push({ kind: 'INACTIVATED', fieldKey });
    }
  }

  return changes;
}
