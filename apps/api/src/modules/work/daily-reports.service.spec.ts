import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditService } from '../audit/audit.service';
import { DailyReportsService } from './daily-reports.service';

const context: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'nebula',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

describe('DailyReportsService calendar dates', () => {
  const tx = {
    $queryRaw: () => {
      throw new Error('Invalid calendar date reached the database');
    },
  } as unknown as Prisma.TransactionClient;
  const service = new DailyReportsService(
    {
      withTenant: (
        _context: TenantContext,
        work: (tx: Prisma.TransactionClient) => unknown,
      ) => work(tx),
    } as unknown as DatabaseContextRunner,
    {} as AuditService,
  );

  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '0000-01-01'])(
    'rejects the nonexistent date %s as an input error',
    async (date) => {
      await expect(service.get(context, date)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: { workDate: expect.any(Array) as unknown },
      });
    },
  );
});
