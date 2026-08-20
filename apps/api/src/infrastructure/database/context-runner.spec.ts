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
