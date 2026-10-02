import type { TenantContext } from '../../common/tenancy/tenant-context';
import { visibleRecordIdsInTransaction } from './record-visibility';

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE',
};

describe('proposal history record visibility', () => {
  it('scopes a batched read to tenant, object, deletion and current OWN owner in the caller transaction', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'visible' }]);
    const tx = { record: { findMany } };
    expect(
      await visibleRecordIdsInTransaction(
        tx as never,
        context,
        'object-a',
        ['visible', 'hidden', 'visible'],
        context.memberId,
      ),
    ).toEqual(['visible']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: context.tenantId,
        objectId: 'object-a',
        id: { in: ['visible', 'hidden'] },
        deletedAt: null,
        ownerMemberId: context.memberId,
      },
      select: { id: true },
    });
  });
});
