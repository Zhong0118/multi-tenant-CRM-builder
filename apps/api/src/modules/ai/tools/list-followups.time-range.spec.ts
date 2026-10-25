import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import type { AuditService } from '../../audit/audit.service';
import { FollowUpsRepository } from '../../follow-ups/follow-ups.repository';
import { FollowUpsService } from '../../follow-ups/follow-ups.service';
import type { PublishedObjectService } from '../../objects/published-object.service';
import { createListFollowupsTool } from './list-followups.tool';

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE',
};

// These explicit ranges represent company-calendar "today" requests. This
// verifies the real tool/service/repository boundary, not model interpretation.
describe('list_followups explicit company-calendar ranges', () => {
  it.each([
    {
      name: 'Shanghai day crossing UTC midnight',
      timezone: 'Asia/Shanghai',
      dueFrom: '2026-09-18T00:00:00.000+08:00',
      dueTo: '2026-09-18T23:59:59.999+08:00',
      startUtc: '2026-09-17T16:00:00.000Z',
      endUtc: '2026-09-18T15:59:59.999Z',
    },
    {
      name: 'New York 23-hour spring transition day',
      timezone: 'America/New_York',
      dueFrom: '2026-03-08T00:00:00.000-05:00',
      dueTo: '2026-03-08T23:59:59.999-04:00',
      startUtc: '2026-03-08T05:00:00.000Z',
      endUtc: '2026-03-09T03:59:59.999Z',
    },
    {
      name: 'New York 25-hour fall transition day',
      timezone: 'America/New_York',
      dueFrom: '2026-11-01T00:00:00.000-04:00',
      dueTo: '2026-11-01T23:59:59.999-05:00',
      startUtc: '2026-11-01T04:00:00.000Z',
      endUtc: '2026-11-02T04:59:59.999Z',
    },
  ])('preserves $name at the database query boundary', async (scenario) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: scenario.timezone }),
      },
      recordFollowUp: { findMany },
    };
    const withTenant = jest.fn(
      (
        _context: TenantContext,
        run: Parameters<DatabaseContextRunner['withTenant']>[1],
      ) => run(tx as never),
    );
    const repository = new FollowUpsRepository(
      { withTenant } as unknown as DatabaseContextRunner,
      {} as AuditService,
    );
    const objects = {
      listAccessible: jest.fn().mockResolvedValue([{ code: 'leads' }]),
      resolveRuntimeSchema: jest.fn().mockResolvedValue({
        schema: { object: { id: 'object-leads', code: 'leads' } },
        access: {
          canRead: true,
          canUpdate: true,
          readScope: 'OWN',
          updateScope: 'OWN',
        },
      }),
    };
    const service = new FollowUpsService(
      repository,
      objects as unknown as PublishedObjectService,
    );
    const tool = createListFollowupsTool(service, context);

    await expect(
      tool.execute(
        {
          objectCode: 'leads',
          status: 'OPEN',
          dueFrom: scenario.dueFrom,
          dueTo: scenario.dueTo,
        },
        'time-range-call',
      ),
    ).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: context.tenantId,
          assigneeMemberId: context.memberId,
          status: 'OPEN',
          dueAt: {
            gte: new Date(scenario.startUtc),
            lte: new Date(scenario.endUtc),
          },
          recordId: undefined,
          record: {
            tenantId: context.tenantId,
            deletedAt: null,
            object: { status: 'ACTIVE', deletedAt: null },
            OR: [{ objectId: 'object-leads', ownerMemberId: context.memberId }],
          },
        },
        take: 20,
      }),
    );
    expect(withTenant).toHaveBeenCalledWith(context, expect.any(Function));
    expect(tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: context.tenantId },
      select: { timezone: true },
    });
  });
});
