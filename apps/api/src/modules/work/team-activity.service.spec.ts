import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { TeamActivityService } from './team-activity.service';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'nebula',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

// Counting runs against a real database in test/work-assignment.e2e-spec.ts;
// these cover who may ask and which ranges are refused before any query.
describe('TeamActivityService', () => {
  const withTenant = jest.fn();
  const service = new TeamActivityService({
    withTenant,
  } as unknown as DatabaseContextRunner);

  beforeEach(() => withTenant.mockReset());

  it('is for company administrators only', async () => {
    await expect(
      service.summarize({ ...admin, role: 'EMPLOYEE' }, {}),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('refuses a reversed range before opening a transaction', async () => {
    await expect(
      service.summarize(admin, { from: '2026-10-22', to: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(withTenant).not.toHaveBeenCalled();
  });
});
