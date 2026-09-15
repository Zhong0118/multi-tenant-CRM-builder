import {
  API_ERROR_MESSAGES,
  type ApiErrorCode,
} from '../../common/errors/api-error-code';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type {
  JsonValue,
  PublishedField,
  PublishedObjectSchema,
} from '../objects/object-schema';

type RecordValueErrorCode = Extract<
  ApiErrorCode,
  | 'OBJECT_ACTION_FORBIDDEN'
  | 'FIELD_UNKNOWN'
  | 'FIELD_REQUIRED'
  | 'FIELD_INVALID'
  | 'FIELD_READ_ONLY'
  | 'FIELD_HIDDEN'
  | 'FIELD_OPTION_INACTIVE'
>;

export class RecordValueError extends Error {
  constructor(
    public readonly code: RecordValueErrorCode,
    public readonly fieldKey?: string,
  ) {
    super(API_ERROR_MESSAGES[code]);
    this.name = 'RecordValueError';
  }
}

/**
 * `records.title` is VARCHAR(300). The only title-eligible field type that can
 * derive a longer title is EMAIL (valid up to 320 characters), so without this
 * limit an over-long title would reach PostgreSQL and fail as 22001 (a 500).
 * It is rejected in domain validation instead, and never truncated.
 */
export const RECORD_TITLE_MAX_LENGTH = 300;

export async function validateRecordMutation(input: {
  mode: 'CREATE' | 'UPDATE';
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  submitted: Record<string, unknown>;
  current?: Record<string, unknown>;
  memberExists: (id: string) => Promise<boolean>;
}): Promise<{ values: Record<string, unknown>; title: string }> {
  assertActionAllowed(input.mode, input.access);

  const fieldsByKey = new Map(
    input.schema.fields.map((field) => [field.fieldKey, field]),
  );
  for (const fieldKey of Object.keys(input.submitted)) {
    if (!fieldsByKey.has(fieldKey)) {
      throw new RecordValueError('FIELD_UNKNOWN', fieldKey);
    }
    assertFieldWritable(fieldKey, input.access);
  }

  const values: Record<string, unknown> =
    input.mode === 'UPDATE' ? { ...(input.current ?? {}) } : {};

  for (const field of input.schema.fields) {
    const wasSubmitted = Object.prototype.hasOwnProperty.call(
      input.submitted,
      field.fieldKey,
    );

    if (wasSubmitted) {
      const submittedValue = input.submitted[field.fieldKey];
      if (submittedValue === null) {
        if (field.required) {
          throw new RecordValueError('FIELD_REQUIRED', field.fieldKey);
        }
        values[field.fieldKey] = null;
      } else {
        values[field.fieldKey] = await normalizeValue(
          field,
          submittedValue,
          input.memberExists,
        );
      }
      continue;
    }

    if (input.mode === 'CREATE' && field.defaultValue !== null) {
      values[field.fieldKey] = await normalizeValue(
        field,
        field.defaultValue,
        input.memberExists,
      );
    }

    if (
      field.required &&
      (values[field.fieldKey] === undefined || values[field.fieldKey] === null)
    ) {
      throw new RecordValueError('FIELD_REQUIRED', field.fieldKey);
    }
  }

  return {
    values,
    title: deriveTitle(input.schema, values),
  };
}

export function projectVisibleValues(
  schema: PublishedObjectSchema,
  access: EffectiveObjectAccess,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    schema.fields.flatMap((field) => {
      const fieldAccess = access.fields[field.fieldKey] ?? 'HIDDEN';
      if (
        fieldAccess === 'HIDDEN' ||
        !Object.prototype.hasOwnProperty.call(values, field.fieldKey)
      ) {
        return [];
      }
      return [[field.fieldKey, values[field.fieldKey]]];
    }),
  );
}

function assertActionAllowed(
  mode: 'CREATE' | 'UPDATE',
  access: EffectiveObjectAccess,
): void {
  if (
    (mode === 'CREATE' && !access.canCreate) ||
    (mode === 'UPDATE' && !access.canUpdate)
  ) {
    throw new RecordValueError('OBJECT_ACTION_FORBIDDEN');
  }
}

function assertFieldWritable(
  fieldKey: string,
  access: EffectiveObjectAccess,
): void {
  const fieldAccess = access.fields[fieldKey] ?? 'HIDDEN';
  if (fieldAccess === 'HIDDEN') {
    throw new RecordValueError('FIELD_HIDDEN', fieldKey);
  }
  if (fieldAccess === 'READ_ONLY') {
    throw new RecordValueError('FIELD_READ_ONLY', fieldKey);
  }
}

async function normalizeValue(
  field: PublishedField,
  value: unknown,
  memberExists: (id: string) => Promise<boolean>,
): Promise<unknown> {
  switch (field.type) {
    case 'TEXT':
      return normalizeText(field, value, 1, 300);
    case 'TEXTAREA':
      return normalizeText(field, value, 0, 10_000);
    case 'PHONE':
      return normalizeText(field, value, 1, 300);
    case 'EMAIL':
      return normalizeEmail(field, value);
    case 'NUMBER':
      return normalizeNumber(field, value);
    case 'MONEY':
      return normalizeMoney(field, value);
    case 'DATE':
      return normalizeDate(field, value);
    case 'DATETIME':
      return normalizeDateTime(field, value);
    case 'SINGLE_SELECT':
      return normalizeSingleSelect(field, value);
    case 'MULTI_SELECT':
      return normalizeMultiSelect(field, value);
    case 'MEMBER':
      return normalizeMember(field, value, memberExists);
    case 'BOOLEAN':
      if (typeof value !== 'boolean') invalid(field);
      return value;
  }
}

function normalizeText(
  field: PublishedField,
  value: unknown,
  defaultMin: number,
  defaultMax: number,
): string {
  if (typeof value !== 'string') invalid(field);
  const minLength = configNumber(field.validation.minLength) ?? defaultMin;
  const maxLength = configNumber(field.validation.maxLength) ?? defaultMax;
  if (value.length < minLength || value.length > maxLength) invalid(field);
  return value;
}

function normalizeEmail(field: PublishedField, value: unknown): string {
  if (typeof value !== 'string') invalid(field);
  const normalized = value.toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    normalized.length > 320
  ) {
    invalid(field);
  }
  return normalized;
}

function normalizeNumber(field: PublishedField, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field);
  const min = configNumber(field.validation.min);
  const max = configNumber(field.validation.max);
  const scale = configInteger(field.validation.scale);
  if (min !== undefined && value < min) invalid(field);
  if (max !== undefined && value > max) invalid(field);
  if (scale !== undefined && !hasScale(value, scale)) invalid(field);
  return value;
}

function normalizeMoney(field: PublishedField, value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))
    invalid(field);
  const scale = configInteger(field.validation.scale) ?? 2;
  const [integerPart, fraction = ''] = value.split('.');
  if (scale < 0 || scale > 12 || fraction.length > scale) invalid(field);

  const numeric = Number(value);
  const min = configNumber(field.validation.min);
  const max = configNumber(field.validation.max);
  if (!Number.isFinite(numeric)) invalid(field);
  if (min !== undefined && numeric < min) invalid(field);
  if (max !== undefined && numeric > max) invalid(field);

  const negative = integerPart.startsWith('-');
  const unsigned = negative ? integerPart.slice(1) : integerPart;
  const normalizedInteger = unsigned.replace(/^0+(?=\d)/, '');
  const sign = negative && numeric !== 0 ? '-' : '';
  return scale === 0
    ? `${sign}${normalizedInteger}`
    : `${sign}${normalizedInteger}.${fraction.padEnd(scale, '0')}`;
}

function normalizeDate(field: PublishedField, value: unknown): string {
  if (typeof value !== 'string') invalid(field);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) invalid(field);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalid(field);
  }
  return value;
}

function normalizeDateTime(field: PublishedField, value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    invalid(field);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid(field);
  return new Date(timestamp).toISOString();
}

function normalizeSingleSelect(field: PublishedField, value: unknown): string {
  if (typeof value !== 'string') invalid(field);
  const option = selectOptions(field).find(
    (candidate) => candidate.key === value,
  );
  if (!option) invalid(field);
  if (option.status === 'INACTIVE') {
    throw new RecordValueError('FIELD_OPTION_INACTIVE', field.fieldKey);
  }
  return value;
}

function normalizeMultiSelect(field: PublishedField, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(field);
  }
  const submitted = new Set(value as string[]);
  const options = selectOptions(field);
  for (const key of submitted) {
    const option = options.find((candidate) => candidate.key === key);
    if (!option) invalid(field);
    if (option.status === 'INACTIVE') {
      throw new RecordValueError('FIELD_OPTION_INACTIVE', field.fieldKey);
    }
  }
  return options
    .filter((option) => submitted.has(option.key))
    .map((option) => option.key);
}

async function normalizeMember(
  field: PublishedField,
  value: unknown,
  memberExists: (id: string) => Promise<boolean>,
): Promise<string> {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) ||
    !(await memberExists(value))
  ) {
    invalid(field);
  }
  return value;
}

function deriveTitle(
  schema: PublishedObjectSchema,
  values: Record<string, unknown>,
): string {
  const titleField = schema.fields.find(
    (field) => field.fieldKey === schema.object.titleFieldKey,
  );
  if (!titleField) {
    throw new RecordValueError('FIELD_REQUIRED', schema.object.titleFieldKey);
  }
  const value = values[titleField.fieldKey];
  if (typeof value !== 'string') {
    throw new RecordValueError('FIELD_REQUIRED', titleField.fieldKey);
  }
  const title =
    titleField.type === 'SINGLE_SELECT'
      ? (selectOptions(titleField).find((option) => option.key === value)
          ?.label ?? value)
      : value;
  // `records.title` is VARCHAR(300), and PostgreSQL measures a VARCHAR in
  // CHARACTERS, while `String.prototype.length` counts UTF-16 code units.
  // Spreading iterates code points, so a title of 300 astral-plane characters
  // (600 code units) is accepted here exactly as the column accepts it, instead
  // of being over-rejected by this guard.
  if ([...title].length > RECORD_TITLE_MAX_LENGTH) {
    throw new RecordValueError('FIELD_INVALID', titleField.fieldKey);
  }
  return title;
}

interface SelectOption {
  key: string;
  label: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function selectOptions(field: PublishedField): SelectOption[] {
  const rawOptions = field.config.options;
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions.flatMap((option) => {
    if (!isJsonObject(option)) return [];
    if (typeof option.key !== 'string' || typeof option.label !== 'string')
      return [];
    return [
      {
        key: option.key,
        label: option.label,
        status: option.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      } satisfies SelectOption,
    ];
  });
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function configNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function configInteger(value: JsonValue | undefined): number | undefined {
  const number = configNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function hasScale(value: number, scale: number): boolean {
  if (scale < 0 || scale > 12) return false;
  const factor = 10 ** scale;
  return (
    Math.abs(value * factor - Math.round(value * factor)) <
    Number.EPSILON * factor
  );
}

function invalid(field: PublishedField): never {
  throw new RecordValueError('FIELD_INVALID', field.fieldKey);
}
