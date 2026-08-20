import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import { assertCanAccept, InvitationPolicyError } from './invitation.policy';

export const INVITATIONS_REPOSITORY = Symbol('INVITATIONS_REPOSITORY');
export const INVITATIONS_CLOCK = Symbol('INVITATIONS_CLOCK');

export type InvitationStatus =
  'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
export type MemberRole = 'TENANT_ADMIN' | 'EMPLOYEE';

export interface PersonalInvitation {
  id: string;
  tenantId: string;
  targetPhone: string;
  targetUserId?: string;
  role: MemberRole;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedByUserId?: string;
  tenantName?: string;
  tenantCode?: string;
}

export interface InvitationMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: MemberRole;
  status: 'ACTIVE' | 'DISABLED';
}

export interface InvitationStore {
  listOwned(user: AuthenticatedUser): Promise<PersonalInvitation[]>;
  findOwned(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PersonalInvitation | null>;
  findMembership(
    tenantId: string,
    userId: string,
  ): Promise<InvitationMembership | null>;
  createMembership(input: {
    tenantId: string;
    userId: string;
    role: MemberRole;
    joinedAt: Date;
  }): Promise<InvitationMembership>;
  markAccepted(
    invitationId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<void>;
  markDeclined(invitationId: string): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface InvitationsRepository {
  withUser<T>(
    userId: string,
    work: (store: InvitationStore) => Promise<T>,
  ): Promise<T>;
  transaction<T>(
    userId: string,
    work: (store: InvitationStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(INVITATIONS_REPOSITORY)
    private readonly repository: InvitationsRepository,
    @Inject(INVITATIONS_CLOCK) private readonly clock: () => Date,
  ) {}

  list(user: AuthenticatedUser): Promise<PersonalInvitation[]> {
    return this.repository.withUser(user.id, (store) => store.listOwned(user));
  }

  detail(
    user: AuthenticatedUser,
    invitationId: string,
  ): Promise<PersonalInvitation> {
    return this.repository.withUser(user.id, async (store) => {
      const invitation = await store.findOwned(invitationId, user);
      if (!invitation) throw new ApiException('INVITATION_NOT_FOUND', 404);
      return invitation;
    });
  }

  accept(
    user: AuthenticatedUser,
    invitationId: string,
    meta: { requestId: string; ip?: string },
  ): Promise<InvitationMembership> {
    return this.repository.transaction(user.id, async (store) => {
      const invitation = await store.findOwned(invitationId, user);
      if (!invitation) throw new ApiException('INVITATION_NOT_FOUND', 404);
      const existing = await store.findMembership(invitation.tenantId, user.id);
      if (invitation.status === 'ACCEPTED' && existing) return existing;
      try {
        assertCanAccept(invitation, user, this.clock());
      } catch (error) {
        throw mapPolicyError(error);
      }
      const membership =
        existing ??
        (await store.createMembership({
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
          joinedAt: this.clock(),
        }));
      await store.markAccepted(invitation.id, user.id, this.clock());
      await store.appendAudit({
        tenantId: invitation.tenantId,
        actorType: 'USER',
        actorId: user.id,
        action: 'invitation.accepted',
        resourceType: 'tenant_invitation',
        resourceId: invitation.id,
        after: { membershipId: membership.id, role: membership.role },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return membership;
    });
  }

  decline(
    user: AuthenticatedUser,
    invitationId: string,
    meta: { requestId: string; ip?: string },
  ): Promise<{ accepted: true }> {
    return this.repository.transaction(user.id, async (store) => {
      const invitation = await store.findOwned(invitationId, user);
      if (!invitation) throw new ApiException('INVITATION_NOT_FOUND', 404);
      try {
        assertCanAccept(invitation, user, this.clock());
      } catch (error) {
        throw mapPolicyError(error);
      }
      await store.markDeclined(invitation.id);
      await store.appendAudit({
        tenantId: invitation.tenantId,
        actorType: 'USER',
        actorId: user.id,
        action: 'invitation.declined',
        resourceType: 'tenant_invitation',
        resourceId: invitation.id,
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return { accepted: true };
    });
  }
}

function mapPolicyError(error: unknown): ApiException {
  if (error instanceof InvitationPolicyError) {
    const status = error.code === 'INVITATION_NOT_FOUND' ? 404 : 409;
    return new ApiException(error.code, status);
  }
  return new ApiException('INVITATION_NOT_FOUND', 404);
}
