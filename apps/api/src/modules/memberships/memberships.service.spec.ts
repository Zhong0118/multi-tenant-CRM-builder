import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  MembershipsService,
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
  invitationCreated = false;
  invitationPage?: { cursor?: string; limit: number };
  member: TenantMemberSummary = {
    id: 'member-admin',
    userId: admin.userId,
    tenantId: admin.tenantId,
    role: 'TENANT_ADMIN',
    status: 'ACTIVE',
  };
  listMembers() {
    return Promise.resolve([this.member]);
  }
  listInvitations(page: { cursor?: string; limit: number }) {
    this.invitationPage = page;
    return Promise.resolve({ items: [], nextCursor: undefined });
  }
  createInvitation() {
    this.invitationCreated = true;
    return Promise.resolve({ id: 'invite-1', status: 'PENDING' as const });
  }
  findMember() {
    return Promise.resolve(this.member);
  }
  countActiveAdmins() {
    return Promise.resolve(this.activeAdminCount);
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
  appendAudit() {
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
    const { service } = serviceFor();
    await expect(
      service.changeMemberStatus(admin, admin.memberId, 'DISABLED', {
        requestId: 'req-1',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' });
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
});
