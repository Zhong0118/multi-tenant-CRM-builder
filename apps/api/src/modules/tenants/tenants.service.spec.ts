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
    activeAdminCount: number;
  }> = [];
  pendingInvitationRole?: string;
  firstAdminInvitation?: {
    id: string;
    targetPhone: string;
    role: 'TENANT_ADMIN';
    status: 'PENDING';
    expiresAt: Date;
  };
  activeAdminCount = 0;
  audits: string[] = [];

  createTenant(input: { name: string; code: string }) {
    const tenant = {
      id: 'tenant-1',
      ...input,
      status: 'DRAFT' as const,
      activeAdminCount: 0,
    };
    this.tenants.push(tenant);
    return Promise.resolve(tenant);
  }

  enterTenant() {
    return Promise.resolve();
  }
  createFirstAdminInvitation(input: {
    targetPhone: string;
    role: 'TENANT_ADMIN';
    expiresAt: Date;
  }) {
    this.pendingInvitationRole = input.role;
    this.firstAdminInvitation = {
      id: 'invite-1',
      targetPhone: input.targetPhone,
      role: input.role,
      status: 'PENDING',
      expiresAt: input.expiresAt,
    };
    return Promise.resolve(this.firstAdminInvitation);
  }
  countActiveAdmins() {
    return Promise.resolve(this.activeAdminCount);
  }
  findTenant(id: string) {
    const tenant = this.tenants.find((candidate) => candidate.id === id);
    return Promise.resolve(
      tenant
        ? {
            ...tenant,
            activeAdminCount: this.activeAdminCount,
            firstAdminInvitation: this.firstAdminInvitation,
          }
        : null,
    );
  }
  listTenants() {
    return Promise.resolve(
      this.tenants.map((tenant) => ({
        ...tenant,
        activeAdminCount: this.activeAdminCount,
        firstAdminInvitation: this.firstAdminInvitation,
      })),
    );
  }
  updateTenantStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
  ) {
    const tenant = this.tenants.find((candidate) => candidate.id === id)!;
    tenant.status = status;
    tenant.activeAdminCount = this.activeAdminCount;
    return Promise.resolve({
      ...tenant,
      firstAdminInvitation: this.firstAdminInvitation,
    });
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
    find: (_actorId: string, id: string) => store.findTenant(id),
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
    expect(result).toMatchObject({
      activeAdminCount: 0,
      firstAdminInvitation: {
        id: 'invite-1',
        targetPhone: '+8613800138000',
        role: 'TENANT_ADMIN',
        status: 'PENDING',
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    });
    expect(store.pendingInvitationRole).toBe('TENANT_ADMIN');
    expect(store.audits).toContain('platform.tenant.created');
  });

  it('returns activation evidence with tenant details', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-company',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    store.activeAdminCount = 1;

    await expect(
      service.detail(platformAdmin, tenant.id),
    ).resolves.toMatchObject({
      activeAdminCount: 1,
      firstAdminInvitation: { id: 'invite-1', status: 'PENDING' },
    });
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
