import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import {
  MembershipsService,
  type MemberObjectAccessSource,
  type MemberFieldAccessChange,
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
  groupLeader = false;
  isGroupLeader() {
    return Promise.resolve(this.groupLeader);
  }
  disabledUsers = new Set<string>();
  async isUsableMember(id: string) {
    return (
      !this.disabledUsers.has(id) &&
      (await this.findMember(id))?.status === 'ACTIVE'
    );
  }
  counts = { records: 0, openTasks: 0 };
  lockMembers() {
    return Promise.resolve();
  }
  async updateMemberRole(id: string, role: 'TENANT_ADMIN' | 'EMPLOYEE') {
    const member = (await this.findMember(id))!;
    member.role = role;
    return member;
  }
  offboardingCounts() {
    return Promise.resolve(this.counts);
  }
  offboardingRecipients() {
    return Promise.resolve([this.member]);
  }
  transferWork() {
    return Promise.resolve(this.counts);
  }
  activeAdminCount = 1;
  adminRosterLocked = false;
  invitationCreated = false;
  invitationName?: string;
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
      fields: [
        {
          fieldId: 'field-secret',
          fieldKey: 'secret',
          label: 'Secret',
          isSystem: false,
          inherited: 'HIDDEN',
          effective: 'HIDDEN',
          override: null,
        },
      ],
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
      fields: [],
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
  createInvitation(input: { displayName?: string }) {
    this.invitationName = input.displayName;
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
  async updateMemberName(id: string, displayName: string) {
    const member = (await this.findMember(id))!;
    member.displayName = displayName;
    return member;
  }
  countActiveAdmins() {
    return Promise.resolve(this.activeAdminCount);
  }
  lockAdminRoster() {
    this.adminRosterLocked = true;
    return Promise.resolve();
  }
  async updateMemberStatus(id: string, status: 'ACTIVE' | 'DISABLED') {
    const member = (await this.findMember(id))!;
    member.status = status;
    return member;
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
  setMemberFieldAccess(
    _memberId: string,
    objectId: string,
    changes: MemberFieldAccessChange[],
  ) {
    const object = this.objectAccess.find(
      (item) => item.objectId === objectId,
    )!;
    for (const change of changes) {
      const field = object.fields.find(
        (item) => item.fieldId === change.fieldId,
      )!;
      field.override = change.access === 'INHERIT' ? null : change.access;
      field.effective = field.override ?? field.inherited;
    }
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

describe('member lifecycle', () => {
  it('prevents last admin demotion and hands admin role to active employee atomically', async () => {
    const store = new MemoryMembershipStore();
    const { service } = serviceFor(store);
    await expect(
      service.changeMemberRole(admin, admin.memberId, 'EMPLOYEE', {
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'TENANT_ADMIN_REQUIRED' });
    await service.handoffAdmin(admin, store.targetMember.id, {
      requestId: 'test',
    });
    expect(store.targetMember.role).toBe('TENANT_ADMIN');
    expect(store.member.role).toBe('EMPLOYEE');
    expect(store.audits.at(-1)?.action).toBe('membership.admin_handoff');
  });
  it('requires handover when disabling owned work and rejects an unauthorized recipient', async () => {
    const store = new MemoryMembershipStore();
    store.counts = { records: 3, openTasks: 2 };
    const { service } = serviceFor(store);
    await expect(
      service.changeMemberStatus(admin, store.targetMember.id, 'DISABLED', {
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    await expect(
      service.offboard(admin, admin.memberId, store.targetMember.id, {
        requestId: 'test',
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
    await expect(
      service.offboard(admin, store.targetMember.id, admin.memberId, {
        requestId: 'test',
      }),
    ).resolves.toEqual({ records: 3, openTasks: 2 });
    expect(store.audits.at(-1)?.action).toBe('membership.offboarded');
  });
});

it('rejects globally disabled users as admin handoff and offboarding recipients', async () => {
  const { service, store } = serviceFor();
  store.disabledUsers.add(store.targetMember.id);
  await expect(
    service.handoffAdmin(admin, store.targetMember.id, { requestId: 'test' }),
  ).rejects.toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
  store.targetMember.role = 'TENANT_ADMIN';
  store.activeAdminCount = 2;
  await expect(
    service.offboard(admin, admin.memberId, store.targetMember.id, {
      requestId: 'test',
    }),
  ).rejects.toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
  expect(store.audits).toEqual([]);
  expect(store.member.status).toBe('ACTIVE');
});

describe('company employee names', () => {
  it('passes the supplied company name into the invitation', async () => {
    const store = new MemoryMembershipStore();
    const { service } = serviceFor(store);
    const input = {
      phone: '13800138000',
      role: 'EMPLOYEE' as const,
      displayName: '公司姓名',
      requestId: 'name-invite',
    };
    await service.invite(admin, input);
    expect(store.invitationName).toBe('公司姓名');
  });
});

describe('company name editing', () => {
  async function change(
    service: MembershipsService,
    context: TenantContext,
    id: string,
  ) {
    return service.changeMemberName(context, id, '公司新姓名', {
      requestId: 'rename',
    });
  }
  it('updates only the chosen company member and appends an audit', async () => {
    const { service, store } = serviceFor();
    const changed = await change(service, admin, store.targetMember.id);
    expect(changed.displayName).toBe('公司新姓名');
    expect(store.member.displayName).toBeUndefined();
    expect(store.audits.at(-1)).toMatchObject({
      action: 'membership.name_changed',
      resourceId: store.targetMember.id,
    });
  });
  it.each(['employee', 'stale-admin', 'foreign-member'])(
    'rejects name editing by %s',
    async (scenario) => {
      const { service, store } = serviceFor();
      if (scenario === 'stale-admin') store.member.role = 'EMPLOYEE';
      await expect(
        change(
          service,
          scenario === 'employee' ? { ...admin, role: 'EMPLOYEE' } : admin,
          scenario === 'foreign-member'
            ? 'other-tenant-member'
            : store.targetMember.id,
        ),
      ).rejects.toMatchObject({
        code:
          scenario === 'foreign-member'
            ? 'MEMBERSHIP_INACTIVE'
            : 'WORKSPACE_FORBIDDEN',
      });
      expect(store.targetMember.displayName).toBeUndefined();
    },
  );
});

describe('bulk member field access', () => {
  it('changes only selected fields, preserves object access, and audits before/after', async () => {
    const { service, store } = serviceFor();
    const apply = (access: MemberFieldAccessChange['access']) =>
      service.bulkMemberAccess(
        admin,
        'object-leads',
        {
          memberIds: [store.targetMember.id],
          fields: [{ fieldId: 'field-secret', access }],
        },
        { requestId: 'bulk' },
      );
    expect(await apply('EDIT')).toEqual({ updated: 1 });
    expect(store.objectAccess[0].override).toBeNull();
    expect(store.objectAccess[0].fields[0]).toMatchObject({
      inherited: 'HIDDEN',
      override: 'EDIT',
      effective: 'EDIT',
    });
    expect(store.audits[0]).toMatchObject({
      before: { fields: [{ override: null, effective: 'HIDDEN' }] },
      after: { fields: [{ override: 'EDIT', effective: 'EDIT' }] },
    });
    await apply('INHERIT');
    expect(store.objectAccess[0].fields[0]).toMatchObject({
      override: null,
      effective: 'HIDDEN',
    });
    expect(store.adminRosterLocked).toBe(true);
  });

  it.each([
    'unknown-member',
    'disabled-user',
    'system-field',
    'unknown-field',
    'stale-admin',
    'no-changes',
    'duplicate-member',
  ])('rejects %s before any write or audit', async (scenario) => {
    const { service, store } = serviceFor();
    if (scenario === 'disabled-user')
      store.disabledUsers.add(store.targetMember.id);
    if (scenario === 'system-field')
      store.objectAccess[0].fields[0].isSystem = true;
    if (scenario === 'stale-admin') store.member.role = 'EMPLOYEE';
    const memberIds = [store.targetMember.id];
    if (scenario === 'unknown-member') memberIds.push('zz-foreign-member');
    if (scenario === 'duplicate-member') memberIds.push(store.targetMember.id);
    await expect(
      service.bulkMemberAccess(
        admin,
        'object-leads',
        {
          memberIds,
          fields:
            scenario === 'no-changes'
              ? []
              : [
                  {
                    fieldId:
                      scenario === 'unknown-field' ? 'unknown' : 'field-secret',
                    access: 'EDIT',
                  },
                ],
        },
        { requestId: 'invalid' },
      ),
    ).rejects.toBeDefined();
    expect(store.objectAccess[0].fields[0].override).toBeNull();
    expect(store.audits).toEqual([]);
  });
});

describe('group read permission grants', () => {
  const policy = {
    mode: 'OVERRIDE' as const,
    canCreate: true,
    canRead: true,
    canUpdate: true,
    readScope: 'GROUP' as const,
    updateScope: 'OWN' as const,
  };
  it('persists independent group fields, preserves omitted settings and clears explicit null', async () => {
    const { service, store } = serviceFor();
    store.groupLeader = true;
    const save = (
      input: typeof policy & {
        groupFieldAccess?: Record<string, 'EDIT' | 'HIDDEN'> | null;
      },
    ) =>
      service.setMemberObjectAccess(
        admin,
        'member-employee',
        'object-leads',
        input,
        { requestId: 'fields' },
      );
    const configured = await save({
      ...policy,
      groupFieldAccess: { secret: 'EDIT' },
    });
    expect(configured.override?.groupFieldAccess).toEqual({ secret: 'EDIT' });
    expect(configured.fields[0].groupEffective).toBe('EDIT');
    expect((await save(policy)).override?.groupFieldAccess).toEqual({
      secret: 'EDIT',
    });
    expect(
      (await save({ ...policy, canUpdate: false })).fields[0].groupEffective,
    ).toBe('READ_ONLY');
    expect(
      (await save({ ...policy, groupFieldAccess: null })).override
        ?.groupFieldAccess,
    ).toBeNull();
  });
  it('rejects unknown keys, invalid access and system EDIT in group settings', async () => {
    const { service, store } = serviceFor();
    store.groupLeader = true;
    for (const groupFieldAccess of [{ unknown: 'EDIT' }, { secret: 'INVALID' }])
      await expect(
        service.setMemberObjectAccess(
          admin,
          'member-employee',
          'object-leads',
          { ...policy, groupFieldAccess } as never,
          { requestId: 'invalid' },
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    store.objectAccess[0].fields[0].isSystem = true;
    await expect(
      service.setMemberObjectAccess(
        admin,
        'member-employee',
        'object-leads',
        { ...policy, groupFieldAccess: { secret: 'EDIT' } },
        { requestId: 'invalid' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rejects grants to non-leaders, accepts leaders without broadening writes, and falls back after leadership ends', async () => {
    const { service, store } = serviceFor();
    await expect(
      service.setMemberObjectAccess(
        admin,
        'member-employee',
        'object-leads',
        policy,
        { requestId: 'group' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.objectAccess[0].override).toBeNull();
    store.groupLeader = true;
    const granted = await service.setMemberObjectAccess(
      admin,
      'member-employee',
      'object-leads',
      policy,
      { requestId: 'group' },
    );
    expect(granted.effective).toMatchObject({
      readScope: 'GROUP',
      updateScope: 'OWN',
    });
    store.groupLeader = false;
    const listed = await service.listMemberObjectAccess(
      admin,
      'member-employee',
    );
    expect(listed[0]).toMatchObject({
      override: { readScope: 'GROUP' },
      effective: { readScope: 'OWN', updateScope: 'OWN' },
    });
  });
  it('rejects a batch GROUP grant before writing any member or field policy', async () => {
    const { service, store } = serviceFor();
    await expect(
      service.bulkMemberAccess(
        admin,
        'object-leads',
        {
          memberIds: ['member-employee'],
          objectAccess: policy,
          fields: [{ fieldId: 'field-secret', access: 'EDIT' }],
        },
        { requestId: 'group-bulk' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.objectAccess[0].override).toBeNull();
    expect(store.objectAccess[0].fields[0].override).toBeNull();
  });
});
