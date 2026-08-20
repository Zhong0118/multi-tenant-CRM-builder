import { TenantsService, type PlatformTenantStore } from './tenants.service';

const platformAdmin = {
  id: 'admin-1',
  phone: '+8613800138000',
  isPlatformAdmin: true,
};

class MemoryStore implements PlatformTenantStore {
  tenants: Array<{
    id: string;
    name: string;
    code: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  }> = [];
  pendingInvitationRole?: string;
  activeAdminCount = 0;
  audits: string[] = [];

  createTenant(input: { name: string; code: string }) {
    const tenant = { id: 'tenant-1', ...input, status: 'DRAFT' as const };
    this.tenants.push(tenant);
    return Promise.resolve(tenant);
  }

  enterTenant() {
    return Promise.resolve();
  }
  createFirstAdminInvitation(input: { role: 'TENANT_ADMIN' }) {
    this.pendingInvitationRole = input.role;
    return Promise.resolve({ id: 'invite-1', status: 'PENDING' as const });
  }
  countActiveAdmins() {
    return Promise.resolve(this.activeAdminCount);
  }
  findTenant(id: string) {
    return Promise.resolve(
      this.tenants.find((tenant) => tenant.id === id) ?? null,
    );
  }
  listTenants() {
    return Promise.resolve(this.tenants);
  }
  updateTenantStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
  ) {
    const tenant = this.tenants.find((candidate) => candidate.id === id)!;
    tenant.status = status;
    return Promise.resolve(tenant);
  }
  appendAudit(input: { action: string }) {
    this.audits.push(input.action);
    return Promise.resolve();
  }
}

function fixture() {
  const store = new MemoryStore();
  const repository = {
    transaction: <T>(
      _actorId: string,
      work: (tx: PlatformTenantStore) => Promise<T>,
    ) => work(store),
    list: () => store.listTenants(),
    find: (id: string) => store.findTenant(id),
  };
  return {
    store,
    service: new TenantsService(
      repository,
      () => new Date('2026-08-20T00:00:00Z'),
      () => 'invite-token',
    ),
  };
}

describe('TenantsService', () => {
  it('creates a draft tenant and first-admin invitation atomically', async () => {
    const { service, store } = fixture();
    const result = await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-company',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    expect(result).toMatchObject({ status: 'DRAFT', code: 'sample-company' });
    expect(store.pendingInvitationRole).toBe('TENANT_ADMIN');
    expect(store.audits).toContain('platform.tenant.created');
  });

  it('refuses activation before an active tenant admin exists', async () => {
    const { service } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-company',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    await expect(
      service.changeStatus(platformAdmin, tenant.id, 'ACTIVE', {
        requestId: 'req-2',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' });
  });

  it('activates after an active tenant administrator exists', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-company',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    store.activeAdminCount = 1;
    await expect(
      service.changeStatus(platformAdmin, tenant.id, 'ACTIVE', {
        requestId: 'req-2',
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(store.audits).toContain('platform.tenant.status_changed');
  });

  it('rejects invalid workspace codes before opening a transaction', async () => {
    const { service } = fixture();
    await expect(
      service.createTenant(platformAdmin, {
        name: '示例公司',
        code: 'Invalid_Code',
        firstAdminPhone: '13800138000',
        requestId: 'req-1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
