import {
  InvitationsService,
  type InvitationStore,
} from './invitations.service';

const user = { id: 'user-1', phone: '+8613800138000', isPlatformAdmin: false };
const now = new Date('2026-08-20T00:00:00Z');

class MemoryInvitationStore implements InvitationStore {
  invitation = {
    id: 'invite-1',
    tenantId: 'tenant-1',
    targetPhone: user.phone,
    targetUserId: user.id,
    role: 'EMPLOYEE' as const,
    status: 'PENDING' as const,
    expiresAt: new Date('2026-08-21T00:00:00Z'),
  };
  membership: {
    id: string;
    tenantId: string;
    userId: string;
    role: 'EMPLOYEE';
    status: 'ACTIVE';
  } | null = null;
  accepted = 0;
  declined = 0;

  listOwned() {
    return Promise.resolve([this.invitation]);
  }
  findOwned(id: string) {
    return Promise.resolve(id === this.invitation.id ? this.invitation : null);
  }
  findMembership() {
    return Promise.resolve(this.membership);
  }
  createMembership() {
    this.membership ??= {
      id: 'member-1',
      tenantId: 'tenant-1',
      userId: user.id,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
    };
    return Promise.resolve(this.membership);
  }
  markAccepted() {
    this.accepted += 1;
    this.invitation.status = 'ACCEPTED' as never;
    return Promise.resolve();
  }
  markDeclined() {
    this.declined += 1;
    this.invitation.status = 'DECLINED' as never;
    return Promise.resolve();
  }
  appendAudit() {
    return Promise.resolve();
  }
}

function fixture() {
  const store = new MemoryInvitationStore();
  const repository = {
    withUser: <T>(
      _userId: string,
      work: (value: InvitationStore) => Promise<T>,
    ) => work(store),
    transaction: <T>(
      _userId: string,
      work: (value: InvitationStore) => Promise<T>,
    ) => work(store),
  };
  return { store, service: new InvitationsService(repository, () => now) };
}

describe('InvitationsService', () => {
  it('returns the existing membership when acceptance is repeated', async () => {
    const { service, store } = fixture();
    const first = await service.accept(user, 'invite-1', {
      requestId: 'req-1',
    });
    const second = await service.accept(user, 'invite-1', {
      requestId: 'req-2',
    });
    expect(second).toEqual(first);
    expect(store.membership).toBeTruthy();
    expect(store.accepted).toBe(1);
  });

  it('declines without creating a membership', async () => {
    const { service, store } = fixture();
    await service.decline(user, 'invite-1', { requestId: 'req-1' });
    expect(store.declined).toBe(1);
    expect(store.membership).toBeNull();
  });
});
