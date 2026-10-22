import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from './context-runner';
import type { DatabaseService } from './database.service';

describe('DatabaseContextRunner', () => {
  it('sets user and tenant settings before running tenant work', async () => {
    const calls: string[] = [];
    const transaction = {
      $queryRawUnsafe: jest.fn((sql: string) => {
        calls.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as Prisma.TransactionClient;
    const database = {
      transaction: jest.fn(
        <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
          work(transaction),
      ),
    } as unknown as DatabaseService;
    const runner = new DatabaseContextRunner(database);
    const context: TenantContext = {
      userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
      tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
      tenantCode: 'tenant-a',
      memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
      role: 'TENANT_ADMIN',
    };

    await runner.withTenant(context, () => {
      calls.push('work');
      return Promise.resolve();
    });

    expect(calls).toEqual([
      "SELECT set_config('app.user_id', $1, true)",
      "SELECT set_config('app.tenant_id', $1, true)",
      'work',
    ]);
    expect(transaction.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('app.user_id', $1, true)",
      context.userId,
    );
    expect(transaction.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      "SELECT set_config('app.tenant_id', $1, true)",
      context.tenantId,
    );
  });
});

describe('pool protection transaction failures', () => {
  const context = {
    userId: 'u',
    tenantId: 't',
    tenantCode: 't',
    memberId: 'm',
    role: 'TENANT_ADMIN',
  } as const;
  it.each([
    [
      'POOL_PROTECTION_OWNER_REQUIRED',
      'VALIDATION_FAILED',
      400,
      '请管理员先分配关联记录的负责人，再确认成交。',
    ],
    ['POOL_PROTECTION_FORBIDDEN', 'OBJECT_ACTION_FORBIDDEN', 403, undefined],
    [
      'Record follow-up deadline expired',
      'RECORD_VERSION_CONFLICT',
      409,
      '跟进期限已到，请刷新记录并重新领取或由管理员分配。',
    ],
    [
      'POOL_PROTECTION_EXPIRED',
      'RECORD_VERSION_CONFLICT',
      409,
      '关联记录的持有期限已到，请刷新并由管理员重新分配后再确认成交。',
    ],
  ])(
    'maps %s to a safe actionable domain error',
    async (marker, code, status, message) => {
      const failure = Object.assign(
        new Error(`Database write failed: ${marker}`),
        { code: 'P2010' },
      );
      const database = {
        transaction: () => Promise.reject(failure),
      } as unknown as DatabaseService;
      const runner = new DatabaseContextRunner(database);
      await expect(
        runner.withTenant(context, () => Promise.resolve()),
      ).rejects.toMatchObject({ code, ...(message ? { message } : {}) });
      await expect(
        runner.withTenant(context, () => Promise.resolve()),
      ).rejects.toHaveProperty('status', status);
    },
  );
  it('keeps unrelated database failures intact', async () => {
    const failure = new Error('unrelated failure');
    const database = {
      transaction: () => Promise.reject(failure),
    } as unknown as DatabaseService;
    await expect(
      new DatabaseContextRunner(database).withTenant(context, () =>
        Promise.resolve(),
      ),
    ).rejects.toBe(failure);
  });
});
