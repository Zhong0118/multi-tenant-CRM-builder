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
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
    expiresAt: Date;
  };
  revokedIds: string[] = [];
  revokeFirstAdminInvitation(id: string) {
    this.revokedIds.push(id);
    return Promise.resolve();
  }
  activeAdminCount = 0;
  tenantPage?: { page: number; limit: number };
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
    return Promise.resolve({
      ...this.firstAdminInvitation,
      status: 'PENDING' as const,
    });
  }
  renewFirstAdminInvitation(
    _id: string,
    input: { invitationCodeHash: string; expiresAt: Date },
  ) {
    this.firstAdminInvitation = {
      ...this.firstAdminInvitation!,
      status: 'PENDING',
      expiresAt: input.expiresAt,
    };
    return Promise.resolve();
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
  listTenants(page: { page: number; limit: number }) {
    this.tenantPage = page;
    return Promise.resolve({
      items: this.tenants.map((tenant) => ({
        ...tenant,
        activeAdminCount: this.activeAdminCount,
        firstAdminInvitation: this.firstAdminInvitation,
      })),
      page: page.page,
      limit: page.limit,
      total: this.tenants.length,
    });
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

  countTenantsByName(name: string) {
    return Promise.resolve(
      this.tenants.filter((tenant) => tenant.name === name).length,
    );
  }

  summarizeTenants() {
    const counts = { total: 0, draft: 0, active: 0, suspended: 0, closed: 0 };
    for (const tenant of this.tenants) {
      counts.total += 1;
      if (tenant.status === 'DRAFT') counts.draft += 1;
      if (tenant.status === 'ACTIVE') counts.active += 1;
      if (tenant.status === 'SUSPENDED') counts.suspended += 1;
      if (tenant.status === 'CLOSED') counts.closed += 1;
    }
    return Promise.resolve(counts);
  }
}

function fixture() {
  const store = new MemoryStore();
  const repository = {
    transaction: <T>(
      _actorId: string,
      work: (tx: PlatformTenantStore) => Promise<T>,
    ) => work(store),
    list: (_actorId: string, page: { page: number; limit: number }) =>
      store.listTenants(page),
    find: (_actorId: string, id: string) => store.findTenant(id),
    summarize: () => store.summarizeTenants(),
    countNameConflicts: (_actorId: string, name: string) =>
      store.countTenantsByName(name),
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
  it('passes controlled page pagination to the tenant store', async () => {
    const { service, store } = fixture();
    await service.list(platformAdmin, { page: 3, limit: 20 });
    expect(store.tenantPage).toEqual({ page: 3, limit: 20 });
  });

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

  it('treats a closed tenant as terminal', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-company',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    store.activeAdminCount = 1;
    await service.changeStatus(platformAdmin, tenant.id, 'CLOSED', {
      requestId: 'req-2',
    });

    await expect(
      service.changeStatus(platformAdmin, tenant.id, 'ACTIVE', {
        requestId: 'req-3',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_STATUS_TRANSITION_INVALID' });
  });

  it('summarizes tenant counts by status without returning rows', async () => {
    const { service, store } = fixture();
    store.tenants.push(
      { id: 'a', name: 'A', code: 'a', status: 'DRAFT', activeAdminCount: 0 },
      { id: 'b', name: 'B', code: 'b', status: 'ACTIVE', activeAdminCount: 1 },
      { id: 'c', name: 'C', code: 'c', status: 'ACTIVE', activeAdminCount: 1 },
      {
        id: 'd',
        name: 'D',
        code: 'd',
        status: 'SUSPENDED',
        activeAdminCount: 1,
      },
      { id: 'e', name: 'E', code: 'e', status: 'CLOSED', activeAdminCount: 0 },
    );
    await expect(service.summarize(platformAdmin)).resolves.toEqual({
      total: 5,
      draft: 1,
      active: 2,
      suspended: 1,
      closed: 1,
    });
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

  it('allows a duplicate company name and reports how many already exist', async () => {
    const { service, store } = fixture();
    await service.createTenant(platformAdmin, {
      name: '示例公司',
      code: 'sample-east',
      firstAdminPhone: '13800138000',
      requestId: 'req-1',
    });
    store.createTenant = (input) => {
      const tenant = {
        id: 'tenant-2',
        ...input,
        status: 'DRAFT' as const,
        activeAdminCount: 0,
      };
      store.tenants.push(tenant);
      return Promise.resolve(tenant);
    };

    await expect(
      service.countNameConflicts(platformAdmin, '示例公司'),
    ).resolves.toEqual({ name: '示例公司', count: 1 });
    await expect(
      service.createTenant(platformAdmin, {
        name: '示例公司',
        code: 'sample-west',
        firstAdminPhone: '13800138001',
        requestId: 'req-2',
      }),
    ).resolves.toMatchObject({ name: '示例公司', code: 'sample-west' });
    await expect(
      service.countNameConflicts(platformAdmin, ' 示例公司 '),
    ).resolves.toEqual({ name: '示例公司', count: 2 });
  });
});

describe('first admin invitation recovery', () => {
  it('renews an expired draft invitation for the same phone and audits it', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: 'Recovery',
      code: 'recovery',
      firstAdminPhone: '13800138000',
      requestId: 'req-create',
    });
    store.firstAdminInvitation!.status = 'EXPIRED';
    store.firstAdminInvitation!.expiresAt = new Date('2026-08-01');
    const result = await service.renewFirstAdminInvitation(
      platformAdmin,
      tenant.id,
      { requestId: 'req-renew' },
    );
    expect(result.firstAdminInvitation).toMatchObject({
      targetPhone: '+8613800138000',
      status: 'PENDING',
      expiresAt: new Date('2026-08-27T00:00:00Z'),
    });
    expect(store.audits).toContain('platform.tenant.admin_invitation_renewed');
  });
  it.each(['ACTIVE', 'SUSPENDED', 'CLOSED'] as const)(
    'does not renew after tenant becomes %s',
    async (status) => {
      const { service, store } = fixture();
      const tenant = await service.createTenant(platformAdmin, {
        name: 'Recovery',
        code: 'recovery',
        firstAdminPhone: '13800138000',
        requestId: 'req-create',
      });
      store.tenants[0].status = status;
      await expect(
        service.renewFirstAdminInvitation(platformAdmin, tenant.id, {
          requestId: 'req-renew',
        }),
      ).rejects.toMatchObject({ code: 'TENANT_STATUS_TRANSITION_INVALID' });
    },
  );
  it('does not replace an accepted invitation or an existing active admin', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: 'Recovery',
      code: 'recovery',
      firstAdminPhone: '13800138000',
      requestId: 'req-create',
    });
    store.firstAdminInvitation!.status = 'ACCEPTED';
    await expect(
      service.renewFirstAdminInvitation(platformAdmin, tenant.id, {
        requestId: 'req-renew',
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_CONFLICT' });
    store.firstAdminInvitation!.status = 'PENDING';
    store.activeAdminCount = 1;
    await expect(
      service.renewFirstAdminInvitation(platformAdmin, tenant.id, {
        requestId: 'req-renew',
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_CONFLICT' });
  });
});

describe('first admin phone correction', () => {
  it('revokes the old invitation and issues an audited invitation for the corrected phone', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: 'A',
      code: 'a',
      firstAdminPhone: '13800138000',
      requestId: 'create',
    });
    const result = await service.correctFirstAdminPhone(
      platformAdmin,
      tenant.id,
      '13900139000',
      { requestId: 'correct' },
    );
    expect(store.revokedIds).toEqual(['invite-1']);
    expect(result.firstAdminInvitation?.targetPhone).toBe('+8613900139000');
    expect(store.audits).toContain('platform.tenant.admin_phone_corrected');
  });
  it('refuses correction after an admin accepts', async () => {
    const { service, store } = fixture();
    const tenant = await service.createTenant(platformAdmin, {
      name: 'A',
      code: 'a',
      firstAdminPhone: '13800138000',
      requestId: 'create',
    });
    store.activeAdminCount = 1;
    await expect(
      service.correctFirstAdminPhone(platformAdmin, tenant.id, '13900139000', {
        requestId: 'correct',
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_CONFLICT' });
    expect(store.revokedIds).toEqual([]);
  });
});
