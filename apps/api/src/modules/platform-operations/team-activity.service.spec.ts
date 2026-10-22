import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { TeamActivityService } from './team-activity.service';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'nebula',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

function harness() {
  const queryRaw = jest
    .fn()
    // the period
    .mockResolvedValueOnce([
      {
        timezone: 'Asia/Shanghai',
        fromAt: new Date('2026-10-21T16:00:00Z'),
        toAt: new Date('2026-10-22T16:00:00Z'),
        fromDay: '2026-10-22',
        toDay: '2026-10-22',
      },
    ])
    // activities by type
    .mockResolvedValueOnce([
      { memberId: 'member-sun', type: 'CALL', count: 12 },
      { memberId: 'member-sun', type: 'MESSAGE', count: 5 },
      { memberId: 'member-li', type: 'MEETING', count: 1 },
    ])
    // distinct records followed
    .mockResolvedValueOnce([{ memberId: 'member-sun', count: 9 }])
    // pool actions
    .mockResolvedValueOnce([
      {
        memberId: 'member-sun',
        action: 'record.ownership_confirm_contact',
        count: 3,
      },
      { memberId: 'member-sun', action: 'record.ownership_claim', count: 4 },
    ])
    // tasks done, overdue, records created
    .mockResolvedValueOnce([{ memberId: 'member-li', count: 2 }])
    .mockResolvedValueOnce([{ memberId: 'member-sun', count: 1 }])
    .mockResolvedValueOnce([{ memberId: 'member-gone', count: 7 }]);
  const tx = {
    $queryRaw: queryRaw,
    tenantMember: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'member-sun',
          displayName: null,
          role: 'EMPLOYEE',
          status: 'ACTIVE',
          user: { displayName: '孙悦' },
        },
        {
          id: 'member-li',
          displayName: '李昂',
          role: 'EMPLOYEE',
          status: 'ACTIVE',
          user: { displayName: '李昂(账号)' },
        },
        {
          id: 'member-quiet',
          displayName: '离职员工',
          role: 'EMPLOYEE',
          status: 'DISABLED',
          user: { displayName: null },
        },
      ]),
    },
  };
  const withTenant = jest.fn(
    (_context: TenantContext, work: (value: typeof tx) => unknown) => work(tx),
  );
  const runner = { withTenant } as unknown as DatabaseContextRunner;
  return { service: new TeamActivityService(runner), withTenant };
}

describe('TeamActivityService', () => {
  it("counts each member's recorded work and leaves out disabled members with nothing in the period", async () => {
    const { service } = harness();
    const result = await service.summarize(admin, { from: '2026-10-22' });

    expect(result).toMatchObject({
      timezone: 'Asia/Shanghai',
      from: '2026-10-22',
      to: '2026-10-22',
    });
    expect(result.members.map((member) => member.name)).toEqual([
      '孙悦',
      '李昂',
    ]);
    expect(result.members[0]).toMatchObject({
      calls: 12,
      messages: 5,
      customersFollowed: 9,
      contactsConfirmed: 3,
      leadsClaimed: 4,
      tasksOverdue: 1,
      recordsCreated: 0,
    });
    expect(result.members[1]).toMatchObject({ visits: 1, tasksDone: 2 });
    // A row for an id that is not a member of this company is ignored.
    expect(result.totals).toMatchObject({
      calls: 12,
      visits: 1,
      recordsCreated: 0,
    });
  });

  it('is for company administrators only and refuses a reversed or over-long range', async () => {
    const { service, withTenant } = harness();
    await expect(
      service.summarize({ ...admin, role: 'EMPLOYEE' }, {}),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_FORBIDDEN',
    });
    await expect(
      service.summarize(admin, { from: '2026-10-22', to: '2026-10-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      service.summarize(admin, { from: '2024-01-01', to: '2026-10-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(withTenant).not.toHaveBeenCalled();
  });
});
