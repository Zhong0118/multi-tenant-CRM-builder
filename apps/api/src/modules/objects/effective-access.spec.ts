import type { PublishedObjectSchema } from './object-schema';
import {
  resolveEffectiveAccess,
  type ObjectAccessPolicy,
} from './effective-access';

function schema(): PublishedObjectSchema {
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
      {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 10,
        isSystem: false,
      },
      {
        id: 'field-phone',
        fieldKey: 'phone',
        label: '电话',
        type: 'PHONE',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 20,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', 'phone'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'NONE',
      fields: { name: 'EDIT', phone: 'READ_ONLY' },
    },
  };
}

describe('effective object access', () => {
  it('gives tenant admins every action, ALL scopes, and EDIT fields', () => {
    expect(
      resolveEffectiveAccess({ schema: schema(), role: 'TENANT_ADMIN' }),
    ).toEqual({
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields: { name: 'EDIT', phone: 'EDIT' },
    });
  });

  it('uses the published employee role policy', () => {
    expect(
      resolveEffectiveAccess({ schema: schema(), role: 'EMPLOYEE' }),
    ).toEqual(schema().employeeAccess);
  });

  it('replaces employee action and scope values with a live member override', () => {
    const memberOverride: ObjectAccessPolicy = {
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'ALL',
    };

    expect(
      resolveEffectiveAccess({
        schema: schema(),
        role: 'EMPLOYEE',
        memberOverride,
      }),
    ).toEqual({
      ...memberOverride,
      fields: { name: 'EDIT', phone: 'READ_ONLY' },
    });
  });

  it('resolves a missing employee permission to no actions and NONE scopes', () => {
    const withoutEmployeePolicy = {
      ...schema(),
      employeeAccess: undefined,
    } as unknown as PublishedObjectSchema;

    expect(
      resolveEffectiveAccess({
        schema: withoutEmployeePolicy,
        role: 'EMPLOYEE',
      }),
    ).toEqual({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      readScope: 'NONE',
      updateScope: 'NONE',
      fields: { name: 'HIDDEN', phone: 'HIDDEN' },
    });
  });

  it('never lets a member override change field access', () => {
    const memberOverride = {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields: { phone: 'EDIT' },
    } as ObjectAccessPolicy;

    expect(
      resolveEffectiveAccess({
        schema: schema(),
        role: 'EMPLOYEE',
        memberOverride,
      }).fields,
    ).toEqual({ name: 'EDIT', phone: 'READ_ONLY' });
  });
});
