import type { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditService } from '../audit/audit.service';
import { PrismaPlatformTenantRepository } from './tenants.repository';

it('applies the same company filters to paginated results and total count', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(22);
  const tx = { $queryRawUnsafe: jest.fn(), tenant: { findMany, count } };
  const database = {
    transaction: (work: (store: typeof tx) => unknown) => work(tx),
  };
  const repository = new PrismaPlatformTenantRepository(
    database as unknown as DatabaseService,
    {} as AuditService,
  );
  const page = await repository.list('admin', {
    page: 2,
    limit: 20,
    status: 'DRAFT',
    search: ' North ',
  });
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ skip: 20, take: 20 }),
  );
  const where = {
    status: 'DRAFT',
    OR: [
      { name: { contains: 'North', mode: 'insensitive' } },
      { code: { contains: 'North', mode: 'insensitive' } },
    ],
  };
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  expect(count).toHaveBeenCalledWith({ where });
  expect(page).toMatchObject({ page: 2, limit: 20, total: 22 });
});

it('locks the tenant before reading lifecycle evidence for a mutation', async () => {
  const query = jest.fn();
  const findUnique = jest.fn().mockImplementation(() => {
    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE',
      'tenant-a',
    );
    return Promise.resolve(null);
  });
  const tx = { $queryRawUnsafe: query, tenant: { findUnique } };
  const database = {
    transaction: (work: (store: typeof tx) => unknown) => work(tx),
  };
  const repository = new PrismaPlatformTenantRepository(
    database as unknown as DatabaseService,
    {} as AuditService,
  );
  await repository.transaction('admin', (store) =>
    store.findTenant('tenant-a', true),
  );
  expect(findUnique).toHaveBeenCalled();
});
