import { FollowUpsService } from './follow-ups.service';
import type { FollowUpsRepository } from './follow-ups.repository';
import type { PublishedObjectService } from '../objects/published-object.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';

const context: TenantContext = {
  tenantId: 'tenant',
  tenantCode: 'demo',
  userId: 'user',
  memberId: 'me',
  role: 'EMPLOYEE',
};
function fixture() {
  const resolved = {
    schema: { object: { id: 'object', code: 'leads' } },
    access: {
      canRead: true,
      canUpdate: true,
      readScope: 'OWN',
      updateScope: 'OWN',
    },
  };
  const objects = {
    resolveRuntimeSchema: jest.fn().mockResolvedValue(resolved),
    listAccessible: jest.fn().mockResolvedValue([{ code: 'leads' }]),
  };
  const repository = {
    activeMember: jest.fn().mockResolvedValue({
      id: 'other',
      userId: 'other-user',
      role: 'EMPLOYEE',
    }),
    findRecord: jest
      .fn()
      .mockResolvedValue({ id: 'record', ownerMemberId: 'me' }),
    create: jest.fn().mockResolvedValue({ id: 'task' }),
    find: jest.fn().mockResolvedValue({
      id: 'task',
      recordId: 'record',
      objectCode: 'leads',
      version: 1,
      status: 'OPEN',
    }),
    update: jest.fn().mockResolvedValue({ id: 'task', status: 'DONE' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getTenantTimezone: jest.fn().mockResolvedValue('Asia/Shanghai'),
    workbench: jest.fn().mockResolvedValue({
      timezone: 'Asia/Shanghai',
      counts: { allOpen: 0, overdue: 0, today: 0, upcoming: 0 },
      preview: { overdue: [], today: [], upcoming: [] },
    }),
  };
  const service = new FollowUpsService(
    repository as unknown as FollowUpsRepository,
    objects as unknown as PublishedObjectService,
  );
  return { service, repository, resolved, objects };
}
describe('personal record follow-ups', () => {
  it.each([
    { version: 1, status: null },
    { version: 1, dueAt: null },
    { version: 1, dueAt: 'bad-date' },
  ])('rejects malformed update %j without writing', async (input) => {
    const { service, repository } = fixture();
    await expect(
      service.update(context, 'task', input as never, { requestId: 'req' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('denies creating a follow-up on a record outside OWN scope', async () => {
    const { service, repository } = fixture();
    repository.findRecord.mockResolvedValue({
      id: 'record',
      ownerMemberId: 'other',
    });
    await expect(
      service.create(
        context,
        {
          objectCode: 'leads',
          recordId: 'record',
          title: 'Call',
          dueAt: '2026-09-10T08:00:00Z',
        },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    { title: '   ', dueAt: '2026-09-10T08:00:00Z' },
    { title: 'Call', dueAt: '2026-09-10T08:00:00' },
    { title: 'Call', dueAt: 'not-a-date' },
    { title: 42, dueAt: '2026-09-10T08:00:00Z' },
  ])('rejects an invalid follow-up create input %j', async (input) => {
    const { service, repository } = fixture();
    await expect(
      service.create(
        context,
        { objectCode: 'leads', recordId: 'record', ...input } as never,
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('trims the title and hands the resolved record scope to the repository transaction', async () => {
    const { service, repository } = fixture();
    await service.create(
      context,
      {
        objectCode: 'leads',
        recordId: 'record',
        title: '  Call  ',
        dueAt: '2026-09-10T08:00:00Z',
      },
      { requestId: 'req' },
    );
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      context,
      {
        objectCode: 'leads',
        recordId: 'record',
        title: 'Call',
        dueAt: '2026-09-10T08:00:00Z',
      },
      { requestId: 'req' },
      {
        objectId: 'object',
        recordId: 'record',
        expectedRole: 'EMPLOYEE',
        requiredOwnerMemberId: 'me',
      },
    );
  });

  it('rechecks UPDATE permission when completing an existing task', async () => {
    const { service, repository, resolved } = fixture();
    resolved.access.canUpdate = false;
    await expect(
      service.update(
        context,
        'task',
        { version: 1, status: 'DONE' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('rejects stale versions and prevents reopening terminal tasks', async () => {
    const { service, repository } = fixture();
    await expect(
      service.update(
        context,
        'task',
        { version: 2, status: 'DONE' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
    repository.find.mockResolvedValue({
      id: 'task',
      recordId: 'record',
      objectCode: 'leads',
      version: 1,
      status: 'DONE',
    });
    await expect(
      service.update(
        context,
        'task',
        { version: 1, dueAt: '2026-09-11T08:00:00Z' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('follow-up reassignment', () => {
  it('denies inactive recipients and performs no mutation', async () => {
    const { service, repository } = fixture();
    repository.activeMember.mockResolvedValue(null);
    await expect(
      service.update(
        context,
        'task',
        { version: 1, assigneeMemberId: 'other' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('evaluates OWN permissions as the recipient, rather than the actor', async () => {
    const { service, repository } = fixture();
    await expect(
      service.update(
        context,
        'task',
        { version: 1, assigneeMemberId: 'other' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('passes both mutation scopes only when recipient can access the record', async () => {
    const { service, repository, resolved } = fixture();
    resolved.access.readScope = 'ALL';
    resolved.access.updateScope = 'ALL';
    await service.update(
      context,
      'task',
      { version: 1, assigneeMemberId: 'other' },
      { requestId: 'req' },
    );
    expect(repository.update).toHaveBeenCalledWith(
      context,
      'task',
      { version: 1, assigneeMemberId: 'other' },
      { requestId: 'req' },
      expect.objectContaining({ recordId: 'record' }),
      expect.objectContaining({ recordId: 'record' }),
    );
  });
});

describe('personal follow-up workbench', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves the actor scopes and the exact tenant-calendar range once', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-17T02:00:00.000Z'));
    const { service, repository, objects } = fixture();

    await service.workbench(context);

    expect(objects.listAccessible).toHaveBeenCalledWith(context);
    expect(repository.getTenantTimezone).toHaveBeenCalledWith(context);
    expect(repository.workbench).toHaveBeenCalledTimes(1);
    expect(repository.workbench).toHaveBeenCalledWith(
      context,
      [
        {
          objectId: 'object',
          ownerMemberId: 'me',
          updateOwnerMemberId: 'me',
          canUpdate: true,
        },
      ],
      {
        now: new Date('2026-09-17T02:00:00.000Z'),
        todayStart: new Date('2026-09-16T16:00:00.000Z'),
        tomorrowStart: new Date('2026-09-17T16:00:00.000Z'),
        day8Start: new Date('2026-09-24T16:00:00.000Z'),
      },
      'Asia/Shanghai',
    );
  });

  it('accepts no actor-selection argument at all', () => {
    const { service } = fixture();

    // The Workbench is always "my own". A second parameter — including an
    // optional one — would let a caller name another member, so the arity is
    // asserted rather than merely documented.
    expect(service.workbench.length).toBe(1);
  });

  it('fails closed on an invalid tenant timezone without querying', async () => {
    const { service, repository } = fixture();
    repository.getTenantTimezone.mockResolvedValue('Not/A_Timezone');

    await expect(service.workbench(context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(repository.workbench).not.toHaveBeenCalled();
  });

  it('fails closed when the tenant has no timezone configured', async () => {
    const { service, repository } = fixture();
    repository.getTenantTimezone.mockResolvedValue(null);

    await expect(service.workbench(context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(repository.workbench).not.toHaveBeenCalled();
  });
});
