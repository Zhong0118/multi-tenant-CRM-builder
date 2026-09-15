import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedObjectSchema } from './object-schema';
import { resolvePublishedObjectInTransaction } from './published-object-transaction';

const employee: TenantContext = {
  userId: 'user-employee',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: 'member-employee',
  role: 'EMPLOYEE',
};

type ObjectStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

interface PermissionRow {
  subjectType: 'MEMBER' | 'ROLE';
  subjectMemberId: string | null;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  readScope: 'ALL' | 'OWN' | 'NONE';
  updateScope: 'ALL' | 'OWN' | 'NONE';
}

interface ObjectRow {
  tenantId: string;
  id: string;
  code: string;
  status: ObjectStatus;
  sortOrder: number;
  activePublication: { configuration: unknown } | null;
  permissions: PermissionRow[];
}

function snapshot(input: {
  code: string;
  canCreate?: boolean;
  canRead?: boolean;
  fieldAccess?: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'>;
}): PublishedObjectSchema {
  return {
    publication: {
      id: `publication-${input.code}`,
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-09-16T00:00:00.000Z',
    },
    object: {
      id: `object-${input.code}`,
      code: input.code,
      name: `对象 ${input.code}`,
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
    },
    fields: [
      {
        id: `field-${input.code}-name`,
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
        id: `field-${input.code}-phone`,
        fieldKey: 'phone',
        label: '手机号',
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
      name: `全部 ${input.code}`,
      columnFieldKeys: ['name', 'phone'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: input.canCreate ?? true,
      canRead: input.canRead ?? true,
      canUpdate: true,
      canDelete: false,
      readScope: input.canRead === false ? 'NONE' : 'OWN',
      updateScope: 'OWN',
      fields: input.fieldAccess ?? { name: 'EDIT', phone: 'READ_ONLY' },
    },
  };
}

function objectRow(
  configuration: PublishedObjectSchema | null,
  overrides: Partial<ObjectRow> = {},
): ObjectRow {
  return {
    tenantId: 'tenant-a',
    id: configuration?.object.id ?? 'object-unpublished',
    code: configuration?.object.code ?? 'unpublished',
    status: 'ACTIVE',
    sortOrder: configuration?.object.sortOrder ?? 99,
    activePublication: configuration === null ? null : { configuration },
    permissions: [],
    ...overrides,
  };
}

interface FindFirstArgs {
  where: { tenantId: string; code: string };
  include: {
    permissions: {
      where: { subjectType: string; subjectMemberId: string };
      take: number;
    };
  };
}

/**
 * Stands in for the `Prisma.TransactionClient` a Transition already owns. It
 * applies the tenant filter and the caller's own MEMBER permission join the way
 * PostgreSQL would (RLS plus the repository's `where`), so every assertion
 * reads a resolved access value instead of a mock echoing its own input.
 */
function transactionOver(rows: ObjectRow[]): Prisma.TransactionClient {
  const findFirst = jest.fn((args: FindFirstArgs) => {
    const row = rows.find(
      (candidate) =>
        candidate.tenantId === args.where.tenantId &&
        candidate.code === args.where.code,
    );
    if (!row) return Promise.resolve(null);
    const permissions = row.permissions
      .filter(
        (permission) =>
          permission.subjectType ===
            args.include.permissions.where.subjectType &&
          permission.subjectMemberId ===
            args.include.permissions.where.subjectMemberId,
      )
      .slice(0, args.include.permissions.take);
    return Promise.resolve({
      id: row.id,
      code: row.code,
      status: row.status,
      sortOrder: row.sortOrder,
      activePublication: row.activePublication,
      permissions,
    });
  });
  return {
    objectDefinition: { findFirst },
  } as unknown as Prisma.TransactionClient;
}

describe('resolvePublishedObjectInTransaction', () => {
  it('resolves a create-only target without applying the read gate', async () => {
    const tx = transactionOver([
      objectRow(
        snapshot({
          code: 'contacts',
          canCreate: true,
          canRead: false,
          fieldAccess: { name: 'HIDDEN', phone: 'HIDDEN' },
        }),
      ),
    ]);

    const resolved = await resolvePublishedObjectInTransaction(
      tx,
      employee,
      'contacts',
    );

    expect(resolved.schema.object.code).toBe('contacts');
    expect(resolved.access).toMatchObject({
      canCreate: true,
      canRead: false,
      readScope: 'NONE',
      canDelete: false,
    });
    expect(resolved.visibleSchema.actions.canRead).toBe(false);
    expect(resolved.visibleSchema.fields).toEqual([]);
    expect(resolved.visibleSchema.defaultView.columnFieldKeys).toEqual([]);
  });

  it('applies the calling member override, including a denied canCreate', async () => {
    const tx = transactionOver([
      objectRow(snapshot({ code: 'leads' }), {
        permissions: [
          {
            subjectType: 'MEMBER',
            subjectMemberId: 'member-other',
            canCreate: true,
            canRead: true,
            canUpdate: true,
            canDelete: false,
            readScope: 'OWN',
            updateScope: 'OWN',
          },
          {
            subjectType: 'MEMBER',
            subjectMemberId: employee.memberId,
            canCreate: false,
            canRead: true,
            canUpdate: false,
            canDelete: true,
            readScope: 'ALL',
            updateScope: 'NONE',
          },
        ],
      }),
    ]);

    const resolved = await resolvePublishedObjectInTransaction(
      tx,
      employee,
      'leads',
    );

    expect(resolved.access).toEqual({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'NONE',
      fields: { name: 'EDIT', phone: 'READ_ONLY' },
    });
  });

  it('reports OBJECT_NOT_FOUND for an inactive or unpublished target', async () => {
    const tx = transactionOver([
      objectRow(snapshot({ code: 'draft-object' }), { status: 'DRAFT' }),
      objectRow(snapshot({ code: 'archived-object' }), { status: 'ARCHIVED' }),
      objectRow(null, { code: 'unpublished-object' }),
    ]);

    for (const code of [
      'draft-object',
      'archived-object',
      'unpublished-object',
    ]) {
      await expect(
        resolvePublishedObjectInTransaction(tx, employee, code),
      ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    }
  });

  it('reports OBJECT_NOT_FOUND for a target owned by another tenant', async () => {
    const tx = transactionOver([
      objectRow(snapshot({ code: 'leads' }), { tenantId: 'tenant-b' }),
    ]);

    await expect(
      resolvePublishedObjectInTransaction(tx, employee, 'leads'),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('maps an unreadable active publication snapshot to INTERNAL_ERROR', async () => {
    const tx = transactionOver([
      objectRow(snapshot({ code: 'corrupt' }), {
        activePublication: {
          configuration: { fields: [{ fieldKey: 'secret' }] },
        },
      }),
    ]);

    await expect(
      resolvePublishedObjectInTransaction(tx, employee, 'corrupt'),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
