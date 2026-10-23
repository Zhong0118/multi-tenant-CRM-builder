import type { Prisma } from '@crm/database';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditService } from '../audit/audit.service';
import { PrismaTemplateApplicationRepository } from './template-application.repository';

it('does not consider a company with an existing dashboard empty for template initialization', async () => {
  const transaction = {
    objectDefinition: { count: jest.fn().mockResolvedValue(0) },
    tenantDashboardConfiguration: { count: jest.fn().mockResolvedValue(1) },
  };
  const repository = new PrismaTemplateApplicationRepository(
    {} as DatabaseService,
    {} as AuditService,
  );
  const store = repository.storeFor(
    transaction as unknown as Prisma.TransactionClient,
  );
  await expect(store.assertTenantEmpty('tenant')).resolves.toBe(false);
  expect(transaction.tenantDashboardConfiguration.count).toHaveBeenCalledWith({
    where: { tenantId: 'tenant' },
  });
});
