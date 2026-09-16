import type {
  PublishedField,
  PublishedFieldType,
  PublishedObjectSchema,
} from '../objects/object-schema';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import {
  projectVisibleValues,
  RECORD_TITLE_MAX_LENGTH,
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

function schema(
  testField: PublishedField,
  titleField: PublishedField = field('TEXT', {
    id: 'field-name',
    fieldKey: 'name',
    label: '姓名',
    required: true,
    sortOrder: 10,
  }),
): PublishedObjectSchema {
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
      titleFieldKey: titleField.fieldKey,
      icon: null,
      sortOrder: 10,
    },
    fields: [titleField, testField].filter(
      (candidate, index, all) =>
        all.findIndex((item) => item.fieldKey === candidate.fieldKey) === index,
    ),
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: [...new Set([titleField.fieldKey, testField.fieldKey])],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields: {
        [titleField.fieldKey]: 'EDIT',
        [testField.fieldKey]: 'EDIT',
      },
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

/** `local@example.com`, so the derived title is exactly `length` characters. */
function emailOfLength(length: number): string {
  const domain = '@example.com';
  return `${'a'.repeat(length - domain.length)}${domain}`;
}

const EMAIL_TITLE_FIELD = field('EMAIL', {
  id: 'field-name',
  fieldKey: 'name',
  label: '邮箱',
  required: true,
  sortOrder: 10,
});

function validateEmailTitle() {
  const testSchema = schema(field('PHONE'), EMAIL_TITLE_FIELD);
  return (email: string) =>
    validateRecordMutation({
      mode: 'CREATE',
      schema: testSchema,
      access: editableAccess(testSchema),
      submitted: { name: email },
      memberExists: () => Promise.resolve(true),
    });
}

/**
 * A TEXT title field whose configured `maxLength` (1000) is above the
 * `records.title` column limit, so the FIELD-level check cannot decide the
 * 300-character boundary: only the derived-title guard can. TEXT/PHONE default
 * to a 300 UTF-16-unit `maxLength`, which would mask the boundary, and
 * TEXTAREA is not a legal title field type (`TITLE_FIELD_TYPES`).
 */
const TEXT_TITLE_FIELD = field('TEXT', {
  id: 'field-name',
  fieldKey: 'name',
  label: '姓名',
  required: true,
  validation: { maxLength: 1000 },
  sortOrder: 10,
});

function validateTextTitle() {
  const testSchema = schema(field('PHONE'), TEXT_TITLE_FIELD);
  return (title: string) =>
    validateRecordMutation({
      mode: 'CREATE',
      schema: testSchema,
      access: editableAccess(testSchema),
      submitted: { name: title },
      memberExists: () => Promise.resolve(true),
    });
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

  it('accepts a derived title that is a valid EMAIL within the column length', async () => {
    const validateEmail = validateEmailTitle();
    const email = 'user@example.com';

    await expect(validateEmail(email)).resolves.toEqual({
      values: { name: email },
      title: email,
    });
  });

  it('accepts a derived EMAIL title of exactly the column length, and rejects one character more', async () => {
    const validateEmail = validateEmailTitle();
    // `'a'.repeat(288) + '@example.com'` is exactly 300 characters: the 288
    // characters of local part plus the 12 of the domain. It is a valid EMAIL
    // as well (300 <= the 320-character EMAIL limit), so the 300/301 boundary
    // IS constructible and is pinned here rather than only asserted as `> 300`.
    const boundary = emailOfLength(RECORD_TITLE_MAX_LENGTH);
    expect(boundary).toBe(`${'a'.repeat(288)}@example.com`);
    expect(boundary).toHaveLength(300);

    await expect(validateEmail(boundary)).resolves.toEqual({
      values: { name: boundary },
      title: boundary,
    });

    const oneMore = `${boundary}a`;
    expect(oneMore).toHaveLength(301);
    await expect(validateEmail(oneMore)).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldKey: 'name',
    });
  });

  it('counts the derived title in characters, not UTF-16 units, at the column boundary', async () => {
    const validateText = validateTextTitle();

    // ASCII: 300 characters == 300 UTF-16 units, so both counts agree.
    const asciiBoundary = 'a'.repeat(RECORD_TITLE_MAX_LENGTH);
    await expect(validateText(asciiBoundary)).resolves.toEqual({
      values: { name: asciiBoundary },
      title: asciiBoundary,
    });
    await expect(validateText(`${asciiBoundary}a`)).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldKey: 'name',
    });

    // Astral plane: each emoji is ONE character to PostgreSQL's VARCHAR(300)
    // but TWO UTF-16 code units to `String.prototype.length`. Counting code
    // units would reject titles of 151-300 astral characters that base
    // accepted and the column stores.
    const astralBoundary = '😀'.repeat(RECORD_TITLE_MAX_LENGTH);
    expect(astralBoundary.length).toBe(600);
    expect([...astralBoundary]).toHaveLength(300);
    await expect(validateText(astralBoundary)).resolves.toEqual({
      values: { name: astralBoundary },
      title: astralBoundary,
    });

    const astralOver = `${astralBoundary}😀`;
    expect([...astralOver]).toHaveLength(301);
    await expect(validateText(astralOver)).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldKey: 'name',
    });
  });

  it('rejects a derived title longer than the records.title column length', async () => {
    const validateEmail = validateEmailTitle();
    // EMAIL accepts up to 320 characters while records.title is VARCHAR(300),
    // so an over-long derived title is reachable. It must be rejected as a
    // domain validation error instead of becoming a database 22001 -> 500.
    const overLong = emailOfLength(301);

    expect(overLong.length).toBeGreaterThan(RECORD_TITLE_MAX_LENGTH);
    await expect(validateEmail(overLong)).rejects.toMatchObject({
      code: 'FIELD_INVALID',
      fieldKey: 'name',
    });
  });

  it.each([301, 310, 320])(
    'rejects a derived EMAIL title of %i characters before any write',
    async (length) => {
      const validateEmail = validateEmailTitle();
      await expect(validateEmail(emailOfLength(length))).rejects.toMatchObject({
        code: 'FIELD_INVALID',
        fieldKey: 'name',
      });
    },
  );

  it('never truncates an over-long derived title to fit the column', async () => {
    const validateEmail = validateEmailTitle();
    await expect(validateEmail(emailOfLength(320))).rejects.toMatchObject({
      code: 'FIELD_INVALID',
    });
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
