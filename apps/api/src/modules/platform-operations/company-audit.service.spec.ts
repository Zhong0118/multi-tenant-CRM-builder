import { CompanyAuditService } from './company-audit.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';

describe('CompanyAuditService', () => {
  const context: TenantContext = {
    userId: 'u',
    tenantId: 'a',
    tenantCode: 'a',
    memberId: 'm',
    role: 'TENANT_ADMIN',
  };
  it('rejects employees before opening a database context', async () => {
    const service = new CompanyAuditService({
      withTenant: () => {
        throw new Error('must not query');
      },
    } as never);
    await expect(
      service.list({ ...context, role: 'EMPLOYEE' }, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });
  it('never accepts an arbitrary tenant filter', async () => {
    const rows = [
      { id: 'own', tenantId: 'a', actorId: null },
      { id: 'other', tenantId: 'b', actorId: null },
    ];
    const tx = {
      auditLog: {
        findMany: ({ where }: { where: { tenantId: string } }) =>
          rows.filter((row) => row.tenantId === where.tenantId),
        count: ({ where }: { where: { tenantId: string } }) =>
          rows.filter((row) => row.tenantId === where.tenantId).length,
      },
    };
    const service = new CompanyAuditService({
      withTenant: (_: unknown, work: (tx: unknown) => unknown) => work(tx),
    } as never);
    const result = await service.list(context, {
      page: 1,
      limit: 20,
      tenantId: 'b',
    });
    expect(result.items.map((row) => row.id)).toEqual(['own']);
    expect(result.total).toBe(1);
  });
});
