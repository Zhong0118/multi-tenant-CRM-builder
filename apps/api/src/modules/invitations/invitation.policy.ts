import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';

export interface InvitationPolicyInput {
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  targetPhone: string;
  expiresAt: Date;
}

export class InvitationPolicyError extends Error {
  constructor(
    readonly code:
      | 'INVITATION_EXPIRED'
      | 'INVITATION_PHONE_MISMATCH'
      | 'INVITATION_NOT_FOUND',
  ) {
    super(code);
  }
}

export function canAccept(
  invitation: InvitationPolicyInput,
  user: AuthenticatedUser,
  now = new Date(),
): boolean {
  try {
    assertCanAccept(invitation, user, now);
    return true;
  } catch {
    return false;
  }
}

export function assertCanAccept(
  invitation: InvitationPolicyInput,
  user: AuthenticatedUser,
  now = new Date(),
): void {
  if (invitation.targetPhone !== user.phone) {
    throw new InvitationPolicyError('INVITATION_PHONE_MISMATCH');
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new InvitationPolicyError('INVITATION_EXPIRED');
  }
  if (invitation.status !== 'PENDING') {
    throw new InvitationPolicyError('INVITATION_NOT_FOUND');
  }
}
