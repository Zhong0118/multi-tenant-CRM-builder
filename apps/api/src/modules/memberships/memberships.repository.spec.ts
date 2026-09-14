import type { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditService } from '../audit/audit.service';
import { PrismaMembershipsRepository } from './memberships.repository';

it.each([{ status: 'REVOKED' }, { expiresAt: new Date() }])(
  'does not overwrite acceptance that wins between invitation read and update: %p',
  async (patch) => {
    let status = 'PENDING';
    const updateMany = jest.fn(
      ({
        where,
        data,
      }: {
        where: { status: string };
        data: { status?: string };
      }) => {
        if (status !== where.status) return Promise.resolve({ count: 0 });
        status = data.status ?? status;
        return Promise.resolve({ count: 1 });
      },
    );
    const transaction = {
      $queryRawUnsafe: jest.fn(),
      tenantInvitation: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 'invitation', status }),
        ),
        updateMany,
      },
    };
    const database = {
      transaction: (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
    } as unknown as DatabaseService;
    const repository = new PrismaMembershipsRepository(
      database,
      {} as AuditService,
    );
    await expect(
      repository.withTenant(
        {
          tenantId: 'tenant',
          tenantCode: 'tenant',
          memberId: 'member',
          userId: 'user',
          role: 'TENANT_ADMIN',
        },
        async (store) => {
          expect((await store.findInvitation('invitation'))?.status).toBe(
            'PENDING',
          );
          status = 'ACCEPTED';
          await store.updateInvitation('invitation', patch);
        },
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    expect(status).toBe('ACCEPTED');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'invitation', tenantId: 'tenant', status: 'PENDING' },
      data: patch,
    });
  },
);

it('skips a membership whose company is hidden from the member', async () => {
  // `tenants_member_select` stops exposing a company once the membership is no
  // longer ACTIVE, so the included relation arrives as null. Dereferencing it
  // used to answer 500 for every offboarded member signing in.
  const transaction = {
    $queryRawUnsafe: jest.fn(),
    tenantMember: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: 'member-active',
            tenantId: 'tenant-active',
            userId: 'user',
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            tenant: { code: 'active', name: 'Active Co', status: 'ACTIVE' },
          },
          {
            id: 'member-disabled',
            tenantId: 'tenant-hidden',
            userId: 'user',
            role: 'EMPLOYEE',
            status: 'DISABLED',
            tenant: null,
          },
        ]),
      ),
    },
  };
  const database = {
    transaction: (work: (tx: typeof transaction) => unknown) =>
      work(transaction),
  } as unknown as DatabaseService;
  const repository = new PrismaMembershipsRepository(
    database,
    {} as AuditService,
  );

  await expect(repository.listWorkspaces('user')).resolves.toEqual([
    {
      tenantId: 'tenant-active',
      tenantCode: 'active',
      tenantName: 'Active Co',
      tenantStatus: 'ACTIVE',
      memberId: 'member-active',
      memberStatus: 'ACTIVE',
      role: 'EMPLOYEE',
    },
  ]);
});
