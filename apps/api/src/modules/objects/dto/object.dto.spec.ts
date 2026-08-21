import { validate } from 'class-validator';

import {
  CreateFieldDefinitionDto,
  EmployeePermissionsDto,
  ExpectedVersionDto,
} from './object.dto';

describe('object configuration DTOs', () => {
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
