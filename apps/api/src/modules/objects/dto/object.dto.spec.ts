import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  CreateFieldDefinitionDto,
  CreateObjectDefinitionDto,
  EmployeePermissionsDto,
  ExpectedVersionDto,
} from './object.dto';

describe('object configuration DTOs', () => {
  const initialField = {
    fieldKey: 'col_1',
    label: '名称',
    type: 'TEXT',
    required: true,
  };

  it('accepts initial fields without a version or system flag', async () => {
    const dto = plainToInstance(CreateObjectDefinitionDto, {
      name: '客户',
      code: 'customers',
      titleFieldKey: 'col_1',
      initialFields: [initialField],
    });
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
  });

  it.each([
    ['missing title', { initialFields: [initialField] }],
    ['empty fields', { initialFields: [], titleFieldKey: 'col_1' }],
    [
      'too many fields',
      {
        initialFields: Array.from({ length: 41 }, () => initialField),
        titleFieldKey: 'col_1',
      },
    ],
    [
      'member',
      {
        initialFields: [{ ...initialField, type: 'MEMBER' }],
        titleFieldKey: 'col_1',
      },
    ],
    [
      'attachment',
      {
        initialFields: [{ ...initialField, type: 'ATTACHMENT' }],
        titleFieldKey: 'col_1',
      },
    ],
    [
      'system flag',
      {
        initialFields: [{ ...initialField, isSystem: true }],
        titleFieldKey: 'col_1',
      },
    ],
    [
      'invalid nested option',
      {
        initialFields: [
          {
            ...initialField,
            type: 'SINGLE_SELECT',
            config: { options: [{ key: 'ok', label: '' }] },
          },
        ],
        titleFieldKey: 'col_1',
      },
    ],
  ])('rejects invalid initial field input: %s', async (_reason, fields) => {
    const dto = plainToInstance(CreateObjectDefinitionDto, {
      name: '客户',
      code: 'customers',
      ...fields,
    });
    expect(
      (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('requires a positive integer configuration version', async () => {
    const dto = Object.assign(new ExpectedVersionDto(), { expectedVersion: 0 });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('expectedVersion');
  });

  it('rejects field types outside the second-slice contract', async () => {
    const dto = Object.assign(new CreateFieldDefinitionDto(), {
      expectedVersion: 1,
      fieldKey: 'attachment',
      label: '附件',
      type: 'ATTACHMENT',
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      isSystem: false,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('type');
  });

  it('never accepts employee record deletion permission', async () => {
    const dto = Object.assign(new EmployeePermissionsDto(), {
      expectedVersion: 1,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      readScope: 'ALL',
      updateScope: 'OWN',
      fields: { name: 'EDIT' },
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('canDelete');
  });
});
