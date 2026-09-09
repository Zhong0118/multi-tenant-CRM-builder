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
  };
  const service = new FollowUpsService(
    repository as unknown as FollowUpsRepository,
    objects as unknown as PublishedObjectService,
  );
  return { service, repository, resolved };
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
