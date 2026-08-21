import type {
  PublishedField,
  PublishedFieldType,
  PublishedObjectSchema,
} from '../objects/object-schema';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import {
  projectVisibleValues,
  RecordValueError,
  validateRecordMutation,
} from './record-value-engine';

const ACTIVE_MEMBER_ID = '018f47a2-4b5c-7d8e-9f01-23456789abcd';

function field(
  type: PublishedFieldType,
  overrides: Partial<PublishedField> = {},
): PublishedField {
  return {
    id: `field-${type.toLowerCase()}`,
    fieldKey: 'value',
    label: '测试字段',
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 20,
    isSystem: false,
    ...overrides,
  };
}

function schema(testField: PublishedField): PublishedObjectSchema {
  return {
    publication: {
      id: 'publication-1',
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-08-21T00:00:00.000Z',
    },
    object: {
      id: 'object-1',
      code: 'leads',
      name: '线索',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
    },
    fields: [
      field('TEXT', {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        required: true,
        sortOrder: 10,
      }),
      testField,
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', testField.fieldKey],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields: { name: 'EDIT', [testField.fieldKey]: 'EDIT' },
    },
  };
}

function editableAccess(
  testSchema: PublishedObjectSchema,
): EffectiveObjectAccess {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    readScope: 'ALL',
    updateScope: 'ALL',
    fields: Object.fromEntries(
      testSchema.fields.map((item) => [item.fieldKey, 'EDIT']),
    ),
  };
}

async function validate(
  testField: PublishedField,
  value: unknown,
): Promise<Record<string, unknown>> {
  const testSchema = schema(testField);
  const result = await validateRecordMutation({
    mode: 'CREATE',
    schema: testSchema,
    access: editableAccess(testSchema),
    submitted: { name: '张三', [testField.fieldKey]: value },
    memberExists: (id) => Promise.resolve(id === ACTIVE_MEMBER_ID),
  });
  return result.values;
}

async function expectInvalid(
  testField: PublishedField,
  value: unknown,
  code = 'FIELD_INVALID',
): Promise<void> {
  await expect(validate(testField, value)).rejects.toMatchObject({ code });
}

describe('dynamic record values', () => {
  const cases: Array<{
    type: PublishedFieldType;
    field?: Partial<PublishedField>;
    valid: unknown;
    normalized: unknown;
    invalid: unknown;
  }> = [
    { type: 'TEXT', valid: '客户 A', normalized: '客户 A', invalid: '' },
    {
      type: 'TEXTAREA',
      valid: '一次有效沟通',
      normalized: '一次有效沟通',
      invalid: 'x'.repeat(10_001),
    },
    {
      type: 'PHONE',
      valid: '010-12345678',
      normalized: '010-12345678',
      invalid: 123,
    },
    {
      type: 'EMAIL',
      valid: 'USER@EXAMPLE.COM',
      normalized: 'user@example.com',
      invalid: 'not-an-email',
    },
    {
      type: 'NUMBER',
      field: { validation: { min: 0, max: 100, scale: 1 } },
      valid: 12.5,
      normalized: 12.5,
      invalid: 12.55,
    },
    {
      type: 'MONEY',
      field: { validation: { scale: 2 } },
      valid: '12.5',
      normalized: '12.50',
      invalid: '12.345',
    },
    {
      type: 'DATE',
      valid: '2026-08-21',
      normalized: '2026-08-21',
      invalid: '2026-02-30',
    },
    {
      type: 'DATETIME',
      valid: '2026-08-21T10:00:00+08:00',
      normalized: '2026-08-21T02:00:00.000Z',
      invalid: 'tomorrow morning',
    },
    {
      type: 'SINGLE_SELECT',
      field: {
        config: {
          options: [
            { key: 'new', label: '新线索', status: 'ACTIVE' },
            { key: 'lost', label: '已流失', status: 'INACTIVE' },
          ],
        },
      },
      valid: 'new',
      normalized: 'new',
      invalid: 'missing',
    },
    {
      type: 'MULTI_SELECT',
      field: {
        config: {
          options: [
            { key: 'new', label: '新线索', status: 'ACTIVE' },
            { key: 'won', label: '已成交', status: 'ACTIVE' },
          ],
        },
      },
      valid: ['won', 'new', 'won'],
      normalized: ['new', 'won'],
      invalid: ['missing'],
    },
    {
      type: 'MEMBER',
      valid: ACTIVE_MEMBER_ID,
      normalized: ACTIVE_MEMBER_ID,
      invalid: '018f47a2-4b5c-7d8e-9f01-000000000000',
    },
    { type: 'BOOLEAN', valid: true, normalized: true, invalid: 'yes' },
  ];

  it.each(cases)(
    'validates and normalizes $type',
    async ({ type, field: overrides, valid, normalized }) => {
      const values = await validate(field(type, overrides), valid);
      expect(values.value).toEqual(normalized);
    },
  );

  it.each(cases)(
    'rejects an invalid $type value',
    async ({ type, field: overrides, invalid }) => {
      await expectInvalid(field(type, overrides), invalid);
    },
  );

  it('rejects an inactive option on a new write', async () => {
    await expectInvalid(
      field('SINGLE_SELECT', {
        config: {
          options: [{ key: 'lost', label: '已流失', status: 'INACTIVE' }],
        },
      }),
      'lost',
      'FIELD_OPTION_INACTIVE',
    );
  });

  it('requires the active-tenant member callback to accept MEMBER values', async () => {
    const testField = field('MEMBER');
    const testSchema = schema(testField);
    const memberExists = jest.fn().mockResolvedValue(false);

    await expect(
      validateRecordMutation({
        mode: 'CREATE',
        schema: testSchema,
        access: editableAccess(testSchema),
        submitted: { name: '张三', value: ACTIVE_MEMBER_ID },
        memberExists,
      }),
    ).rejects.toMatchObject({ code: 'FIELD_INVALID', fieldKey: 'value' });
    expect(memberExists).toHaveBeenCalledWith(ACTIVE_MEMBER_ID);
  });

  it('rejects a missing required title and unknown fields', async () => {
    const testSchema = schema(field('PHONE'));
    const base = {
      mode: 'CREATE' as const,
      schema: testSchema,
      access: editableAccess(testSchema),
      memberExists: () => Promise.resolve(true),
    };

    await expect(
      validateRecordMutation({ ...base, submitted: { value: '010-12345678' } }),
    ).rejects.toMatchObject({ code: 'FIELD_REQUIRED', fieldKey: 'name' });
    await expect(
      validateRecordMutation({
        ...base,
        submitted: { name: '张三', forged: true },
      }),
    ).rejects.toMatchObject({ code: 'FIELD_UNKNOWN', fieldKey: 'forged' });
  });

  it.each(['READ_ONLY', 'HIDDEN'] as const)(
    'rejects forged submissions to %s fields',
    async (fieldAccess) => {
      const testSchema = schema(field('PHONE'));
      const access = editableAccess(testSchema);
      access.fields.value = fieldAccess;

      await expect(
        validateRecordMutation({
          mode: 'CREATE',
          schema: testSchema,
          access,
          submitted: { name: '张三', value: '010-12345678' },
          memberExists: () => Promise.resolve(true),
        }),
      ).rejects.toMatchObject({
        code: fieldAccess === 'HIDDEN' ? 'FIELD_HIDDEN' : 'FIELD_READ_ONLY',
        fieldKey: 'value',
      });
    },
  );

  it('keeps missing PATCH values and allows null only for optional fields', async () => {
    const testSchema = schema(field('PHONE'));
    const input = {
      mode: 'UPDATE' as const,
      schema: testSchema,
      access: editableAccess(testSchema),
      current: { name: '张三', value: '010-12345678', historical: 'keep' },
      memberExists: () => Promise.resolve(true),
    };

    await expect(
      validateRecordMutation({ ...input, submitted: { name: '李四' } }),
    ).resolves.toMatchObject({
      values: { name: '李四', value: '010-12345678', historical: 'keep' },
      title: '李四',
    });
    await expect(
      validateRecordMutation({ ...input, submitted: { value: null } }),
    ).resolves.toMatchObject({ values: { name: '张三', value: null } });
    await expect(
      validateRecordMutation({ ...input, submitted: { name: null } }),
    ).rejects.toMatchObject({ code: 'FIELD_REQUIRED', fieldKey: 'name' });
  });

  it('derives a display title from a single-select title field', async () => {
    const titleField = field('SINGLE_SELECT', {
      id: 'field-name',
      fieldKey: 'name',
      label: '阶段',
      required: true,
      config: {
        options: [{ key: 'new', label: '新线索', status: 'ACTIVE' }],
      },
    });
    const testSchema = schema(field('PHONE'));
    testSchema.fields[0] = titleField;

    await expect(
      validateRecordMutation({
        mode: 'CREATE',
        schema: testSchema,
        access: editableAccess(testSchema),
        submitted: { name: 'new' },
        memberExists: () => Promise.resolve(true),
      }),
    ).resolves.toMatchObject({ title: '新线索' });
  });

  it('projects response values by field visibility', () => {
    const testSchema = schema(field('PHONE'));
    const access = editableAccess(testSchema);
    access.fields.value = 'HIDDEN';

    expect(
      projectVisibleValues(testSchema, access, {
        name: '张三',
        value: '010-12345678',
        historical: 'secret',
      }),
    ).toEqual({ name: '张三' });
  });

  it('treats a missing field-access entry as hidden', () => {
    const testSchema = schema(field('PHONE'));
    const access = editableAccess(testSchema);
    delete access.fields.value;

    expect(
      projectVisibleValues(testSchema, access, {
        name: '张三',
        value: '010-12345678',
      }),
    ).toEqual({ name: '张三' });
  });

  it('exposes stable validation errors without leaking submitted values', () => {
    const error = new RecordValueError('FIELD_INVALID', 'email');
    expect(error).toMatchObject({ code: 'FIELD_INVALID', fieldKey: 'email' });
    expect(error.message).not.toContain('email@example.com');
  });
});
