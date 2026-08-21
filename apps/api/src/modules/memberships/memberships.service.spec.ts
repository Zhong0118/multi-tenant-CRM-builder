import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import {
  MembershipsService,
  type MemberObjectAccessSource,
  type MembershipStore,
  type TenantMemberSummary,
} from './memberships.service';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-1',
  tenantCode: 'tenant-one',
  memberId: 'member-admin',
  role: 'TENANT_ADMIN',
};

class MemoryMembershipStore implements MembershipStore {
  activeAdminCount = 1;
  adminRosterLocked = false;
  invitationCreated = false;
  invitationPage?: { cursor?: string; limit: number };
  memberPage?: { page: number; limit: number };
  member: TenantMemberSummary = {
    id: 'member-admin',
    userId: admin.userId,
    tenantId: admin.tenantId,
    role: 'TENANT_ADMIN',
    status: 'ACTIVE',
  };
  targetMember: TenantMemberSummary = {
    id: 'member-employee',
    userId: 'user-employee',
    tenantId: admin.tenantId,
    role: 'EMPLOYEE',
    status: 'ACTIVE',
  };
  objectAccess: MemberObjectAccessSource[] = [
    {
      objectId: 'object-leads',
      objectCode: 'leads',
      objectName: '销售线索',
      inherited: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false as const,
        readScope: 'OWN' as const,
        updateScope: 'OWN' as const,
      },
      override: null,
    },
    {
      objectId: 'object-customers',
      objectCode: 'customers',
      objectName: '客户',
      inherited: {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false as const,
        readScope: 'ALL' as const,
        updateScope: 'NONE' as const,
      },
      override: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false as const,
        readScope: 'OWN' as const,
        updateScope: 'OWN' as const,
      },
    },
  ];
  audits: AuditEvent[] = [];
  listMembers(page: { page: number; limit: number }) {
    this.memberPage = page;
    return Promise.resolve({
      items: [this.member],
      page: page.page,
      limit: page.limit,
      total: 1,
      activeAdminCount: 1,
    });
  }
  listInvitations(page: { cursor?: string; limit: number }) {
    this.invitationPage = page;
    return Promise.resolve({ items: [], nextCursor: undefined });
  }
  createInvitation() {
    this.invitationCreated = true;
    return Promise.resolve({ id: 'invite-1', status: 'PENDING' as const });
  }
  findMember(id: string) {
    return Promise.resolve(
      id === this.member.id
        ? this.member
        : id === this.targetMember.id
          ? this.targetMember
          : null,
    );
  }
  countActiveAdmins() {
    return Promise.resolve(this.activeAdminCount);
  }
  lockAdminRoster() {
    this.adminRosterLocked = true;
    return Promise.resolve();
  }
  updateMemberStatus(_id: string, status: 'ACTIVE' | 'DISABLED') {
    this.member.status = status;
    return Promise.resolve(this.member);
  }
  findInvitation() {
    return Promise.resolve(null);
  }
  updateInvitation() {
    return Promise.resolve();
  }
  listPublishedObjectAccess() {
    return Promise.resolve(structuredClone(this.objectAccess));
  }
  replaceMemberObjectAccess(
    _memberId: string,
    objectId: string,
    policy: (typeof this.objectAccess)[number]['inherited'],
  ) {
    const object = this.objectAccess.find((item) => item.objectId === objectId);
    if (object) object.override = structuredClone(policy);
    return Promise.resolve();
  }
  deleteMemberObjectAccess(_memberId: string, objectId: string) {
    const object = this.objectAccess.find((item) => item.objectId === objectId);
    if (object) object.override = null;
    return Promise.resolve();
  }
  appendAudit(event: AuditEvent) {
    this.audits.push(event);
    return Promise.resolve();
  }
}

function serviceFor(store = new MemoryMembershipStore()) {
  const repository = {
    withTenant: <T>(
      _context: TenantContext,
      work: (value: MembershipStore) => Promise<T>,
    ) => work(store),
    listWorkspaces: () =>
      Promise.resolve([
        {
          tenantCode: 'active',
          memberStatus: 'ACTIVE' as const,
          tenantStatus: 'ACTIVE' as const,
        },
        {
          tenantCode: 'disabled',
          memberStatus: 'DISABLED' as const,
          tenantStatus: 'ACTIVE' as const,
        },
      ]),
  };
  return {
    store,
    service: new MembershipsService(
      repository,
      () => new Date(),
      () => 'token',
    ),
  };
}

describe('MembershipsService', () => {
  it('does not allow an employee to read the member roster', async () => {
    const { service, store } = serviceFor();
    await expect(
      service.listMembers(
        { ...admin, role: 'EMPLOYEE' },
        { page: 1, limit: 20 },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(store.memberPage).toBeUndefined();
  });

  it('passes controlled page pagination to the member store', async () => {
    const { service, store } = serviceFor();
    await service.listMembers(admin, { page: 2, limit: 50 });
    expect(store.memberPage).toEqual({ page: 2, limit: 50 });
  });

  it('does not allow an employee to invite', async () => {
    const { service } = serviceFor();
    await expect(
      service.invite(
        { ...admin, role: 'EMPLOYEE' },
        {
          phone: '13800138000',
          role: 'EMPLOYEE',
          requestId: 'req-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });

  it('does not disable the last active tenant administrator', async () => {
    const { service, store } = serviceFor();
    await expect(
      service.changeMemberStatus(admin, admin.memberId, 'DISABLED', {
        requestId: 'req-1',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' });
    expect(store.adminRosterLocked).toBe(true);
  });

  it('keeps inactive memberships visible in the personal workspace list', async () => {
    const { service } = serviceFor();
    await expect(service.listWorkspaces('user-1')).resolves.toEqual([
      expect.objectContaining({
        tenantCode: 'active',
        memberStatus: 'ACTIVE',
      }),
      expect.objectContaining({
        tenantCode: 'disabled',
        memberStatus: 'DISABLED',
      }),
    ]);
  });

  it('passes stable cursor pagination to the invitation store', async () => {
    const { service, store } = serviceFor();
    await service.listInvitations(admin, { cursor: 'invite-20', limit: 20 });
    expect(store.invitationPage).toEqual({ cursor: 'invite-20', limit: 20 });
  });

  it('only lets tenant admins read member object access', async () => {
    const { service } = serviceFor();
    await expect(
      service.listMemberObjectAccess(
        { ...admin, role: 'EMPLOYEE' },
        'member-employee',
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });

  it('joins every published object with inherited and override access', async () => {
    const { service } = serviceFor();
    const result = await service.listMemberObjectAccess(
      admin,
      'member-employee',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      objectId: 'object-leads',
      mode: 'INHERIT',
      override: null,
      effective: { readScope: 'OWN' },
    });
    expect(result[1]).toMatchObject({
      objectId: 'object-customers',
      mode: 'OVERRIDE',
      effective: { readScope: 'OWN' },
    });
  });

  it('requires an active employee target and active published object', async () => {
    const { service, store } = serviceFor();
    store.targetMember.status = 'DISABLED';
    await expect(
      service.setMemberObjectAccess(
        admin,
        'member-employee',
        'object-leads',
        { mode: 'INHERIT' },
        { requestId: 'req-access' },
      ),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });

    store.targetMember.status = 'ACTIVE';
    await expect(
      service.setMemberObjectAccess(
        admin,
        'member-employee',
        'object-missing',
        { mode: 'INHERIT' },
        { requestId: 'req-access' },
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('replaces a complete override, restores inheritance, and audits both', async () => {
    const { service, store } = serviceFor();
    const overridden = await service.setMemberObjectAccess(
      admin,
      'member-employee',
      'object-leads',
      {
        mode: 'OVERRIDE',
        canCreate: false,
        canRead: false,
        canUpdate: false,
        readScope: 'NONE',
        updateScope: 'NONE',
      },
      { requestId: 'req-override' },
    );
    expect(overridden).toMatchObject({
      mode: 'OVERRIDE',
      override: { canDelete: false, readScope: 'NONE' },
      effective: { canDelete: false, readScope: 'NONE' },
    });

    const inherited = await service.setMemberObjectAccess(
      admin,
      'member-employee',
      'object-leads',
      { mode: 'INHERIT' },
      { requestId: 'req-inherit' },
    );
    expect(inherited).toMatchObject({
      mode: 'INHERIT',
      override: null,
      effective: { readScope: 'OWN' },
    });
    expect(store.audits).toEqual([
      expect.objectContaining({
        action: 'membership.object_access_changed',
        requestId: 'req-override',
      }),
      expect.objectContaining({
        action: 'membership.object_access_changed',
        requestId: 'req-inherit',
      }),
    ]);
  });
});
