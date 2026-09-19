import type { FollowUpsService } from '../../follow-ups/follow-ups.service';
import { createListFollowupsTool } from './list-followups.tool';

const employee = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE' as const,
};

const RECORD_ID = '018f47a2-4b5c-7d8e-9f01-00000000000f';

const ACTOR_OVERRIDE_KEYS = {
  tenantId: 'other-tenant',
  memberId: 'other-member',
  userId: 'other-user',
  role: 'TENANT_ADMIN' as const,
  readScope: 'ALL',
  includeHidden: true,
  bypassPermission: true,
  runAsAdmin: true,
  assigneeMemberId: 'member-other',
};

describe('list_followups', () => {
  it('rejects assignee and actor-override keys and caps limit at 20', () => {
    const tool = createListFollowupsTool({} as FollowUpsService, employee);
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
    expect(tool.inputSchema.parse({})).toMatchObject({ limit: 20 });
    expect(tool.inputSchema.safeParse({ limit: 21 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      tool.inputSchema.safeParse({ assigneeMemberId: 'member-other' }).success,
    ).toBe(false);
    expect(tool.inputSchema.safeParse(ACTOR_OVERRIDE_KEYS).success).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        status: 'OPEN',
        dueFrom: '2026-09-01T00:00:00.000Z',
        dueTo: '2026-09-30T00:00:00.000Z',
        objectCode: 'leads',
        recordId: RECORD_ID,
        limit: 5,
      }).success,
    ).toBe(true);
  });

  it('calls FollowUpsService.listForAi with the parsed input and actor context', async () => {
    const items = [
      {
        id: 'task-1',
        objectCode: 'leads',
        objectName: '销售线索',
        recordId: RECORD_ID,
        recordTitle: '张三',
        title: '回访客户',
        dueAt: '2026-09-20T00:00:00.000Z',
        status: 'OPEN',
        overdue: true,
      },
    ];
    const listForAi = jest.fn().mockResolvedValue(items);
    const tool = createListFollowupsTool(
      { listForAi } as unknown as FollowUpsService,
      employee,
    );

    await expect(
      tool.execute(
        {
          status: 'OPEN',
          objectCode: 'leads',
          recordId: RECORD_ID,
          limit: 5,
        },
        'call-1',
      ),
    ).resolves.toEqual(items);
    expect(listForAi).toHaveBeenCalledWith(employee, {
      status: 'OPEN',
      objectCode: 'leads',
      recordId: RECORD_ID,
      limit: 5,
    });
    expect(listForAi.mock.calls[0][1]).not.toHaveProperty('assigneeMemberId');
  });
});
