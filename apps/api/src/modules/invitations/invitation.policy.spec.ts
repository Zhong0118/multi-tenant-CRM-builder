import { assertCanAccept, canAccept } from './invitation.policy';

const user = { id: 'user-1', phone: '+8613800138000', isPlatformAdmin: false };
const future = new Date('2026-08-21T00:00:00Z');
const now = new Date('2026-08-20T00:00:00Z');

describe('invitation acceptance policy', () => {
  it('allows a pending unexpired invitation for the verified phone', () => {
    expect(
      canAccept(
        { status: 'PENDING', targetPhone: user.phone, expiresAt: future },
        user,
        now,
      ),
    ).toBe(true);
  });

  it('rejects an expired invitation with a stable error', () => {
    expect(() =>
      assertCanAccept(
        {
          status: 'PENDING',
          targetPhone: user.phone,
          expiresAt: new Date('2026-08-19T00:00:00Z'),
        },
        user,
        now,
      ),
    ).toThrow('INVITATION_EXPIRED');
  });

  it('rejects an invitation for another phone', () => {
    expect(() =>
      assertCanAccept(
        {
          status: 'PENDING',
          targetPhone: '+8613900000000',
          expiresAt: future,
        },
        user,
        now,
      ),
    ).toThrow('INVITATION_PHONE_MISMATCH');
  });
});
