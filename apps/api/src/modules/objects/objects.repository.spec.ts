import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditService } from '../audit/audit.service';
import { PrismaObjectsRepository } from './objects.repository';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-1',
  tenantCode: 'baijie',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

const otherTenantAdmin: TenantContext = {
  ...admin,
  tenantId: 'tenant-2',
  tenantCode: 'other',
};

function repository(transaction: object) {
  return new PrismaObjectsRepository(
    {
      withTenant: async <T>(
        _context: TenantContext,
        work: (value: never) => Promise<T>,
      ) => work(transaction as never),
    } as unknown as DatabaseContextRunner,
    {} as AuditService,
  );
}

describe('PrismaObjectsRepository target lookup', () => {
  it('resolves target objects by tenant and reads the current active publication', async () => {
    const queries: unknown[] = [];
    const store = repository({
      objectDefinition: {
        findMany: (args: unknown) => {
          queries.push(args);
          return Promise.resolve([
            {
              code: 'contacts',
              status: 'ACTIVE',
              activePublication: {
                configuration: { object: { code: 'contacts' } },
              },
            },
            { code: 'deals', status: 'DRAFT', activePublication: null },
          ]);
        },
      },
    });

    const targets = await store.withTenant(admin, (objects) =>
      objects.findActionTargetObjects([
        'contacts',
        'deals',
        'missing',
        'contacts',
      ]),
    );

    // §25/§26: the lookup is scoped to the caller's tenant, asks only for the
    // referenced codes, and never consults object_permissions rows — the
    // employee policy comes from the published snapshot.
    expect(queries).toEqual([
      {
        where: {
          tenantId: 'tenant-1',
          code: { in: ['contacts', 'deals', 'missing'] },
        },
        select: {
          code: true,
          status: true,
          activePublication: { select: { configuration: true } },
        },
      },
    ]);
    expect([...targets.keys()]).toEqual(['contacts', 'deals']);
    expect(targets.get('contacts')).toEqual({
      code: 'contacts',
      status: 'ACTIVE',
      schema: { object: { code: 'contacts' } },
    });
    // An object without an Active Publication is reported as unpublished, and a
    // code that does not exist in this tenant is absent — never another
    // tenant's object.
    expect(targets.get('deals')).toEqual({
      code: 'deals',
      status: 'DRAFT',
      schema: null,
    });
    expect(targets.has('missing')).toBe(false);
  });

  it('scopes the lookup to the calling tenant', async () => {
    const queries: Array<{ where: { tenantId: string } }> = [];
    const store = repository({
      objectDefinition: {
        findMany: (args: { where: { tenantId: string } }) => {
          queries.push(args);
          return Promise.resolve([]);
        },
      },
    });

    await store.withTenant(otherTenantAdmin, (objects) =>
      objects.findActionTargetObjects(['contacts']),
    );

    expect(queries.map((query) => query.where.tenantId)).toEqual(['tenant-2']);
  });

  it('does not query when no target object is referenced', async () => {
    const queries: unknown[] = [];
    const store = repository({
      objectDefinition: {
        findMany: (args: unknown) => {
          queries.push(args);
          return Promise.resolve([]);
        },
      },
    });

    const targets = await store.withTenant(admin, (objects) =>
      objects.findActionTargetObjects([]),
    );

    expect(queries).toEqual([]);
    expect(targets.size).toBe(0);
  });
});
