import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import { normalizeChineseMobile } from '../auth/phone-number';
import type { MemberRole } from '../invitations/invitations.service';

export const MEMBERSHIPS_REPOSITORY = Symbol('MEMBERSHIPS_REPOSITORY');
export const MEMBERSHIPS_CLOCK = Symbol('MEMBERSHIPS_CLOCK');
export const MEMBERSHIP_INVITATION_TOKEN = Symbol(
  'MEMBERSHIP_INVITATION_TOKEN',
);

export interface WorkspaceSummary {
  tenantCode: string;
  tenantId?: string;
  tenantName?: string;
  tenantStatus: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  memberId?: string;
  memberStatus: 'ACTIVE' | 'DISABLED';
  role?: MemberRole;
}

export interface TenantMemberSummary {
  id: string;
  userId: string;
  tenantId: string;
  role: MemberRole;
  status: 'ACTIVE' | 'DISABLED';
  displayName?: string;
  phone?: string;
}

export interface MemberPageQuery {
  page: number;
  limit: number;
}

export interface TenantMemberPage {
  items: TenantMemberSummary[];
  page: number;
  limit: number;
  total: number;
  activeAdminCount: number;
}

export interface MemberObjectPolicy {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: false;
  readScope: 'ALL' | 'OWN' | 'NONE';
  updateScope: 'ALL' | 'OWN' | 'NONE';
}

export interface MemberObjectAccessSource {
  objectId: string;
  objectCode: string;
  objectName: string;
  inherited: MemberObjectPolicy;
  override: MemberObjectPolicy | null;
}

export interface MemberObjectAccess extends MemberObjectAccessSource {
  mode: 'INHERIT' | 'OVERRIDE';
  effective: MemberObjectPolicy;
}

export type MemberObjectAccessInput =
  | { mode: 'INHERIT' }
  | {
      mode: 'OVERRIDE';
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      readScope: 'ALL' | 'OWN' | 'NONE';
      updateScope: 'ALL' | 'OWN' | 'NONE';
    };

export interface InvitationPageQuery {
  cursor?: string;
  limit: number;
}

export interface TenantInvitationSummary {
  id: string;
  targetPhone: string;
  targetUserId: string | null;
  role: MemberRole;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationPage {
  items: TenantInvitationSummary[];
  nextCursor?: string;
}

export interface MembershipStore {
  listMembers(page: MemberPageQuery): Promise<TenantMemberPage>;
  lockAdminRoster(): Promise<void>;
  listInvitations(page: InvitationPageQuery): Promise<InvitationPage>;
  createInvitation(input: {
    tenantId: string;
    targetPhone: string;
    role: MemberRole;
    invitationCodeHash: string;
    createdByUserId: string;
    expiresAt: Date;
  }): Promise<{ id: string; status: 'PENDING' }>;
  findMember(id: string): Promise<TenantMemberSummary | null>;
  countActiveAdmins(): Promise<number>;
  updateMemberStatus(
    id: string,
    status: 'ACTIVE' | 'DISABLED',
  ): Promise<TenantMemberSummary>;
  listPublishedObjectAccess(
    memberId: string,
  ): Promise<MemberObjectAccessSource[]>;
  replaceMemberObjectAccess(
    memberId: string,
    objectId: string,
    policy: MemberObjectPolicy,
  ): Promise<void>;
  deleteMemberObjectAccess(memberId: string, objectId: string): Promise<void>;
  findInvitation(id: string): Promise<{ id: string; status: string } | null>;
  updateInvitation(id: string, input: Record<string, unknown>): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface MembershipsRepository {
  withTenant<T>(
    context: TenantContext,
    work: (store: MembershipStore) => Promise<T>,
  ): Promise<T>;
  listWorkspaces(userId: string): Promise<WorkspaceSummary[]>;
}

@Injectable()
export class MembershipsService {
  constructor(
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly repository: MembershipsRepository,
    @Inject(MEMBERSHIPS_CLOCK) private readonly clock: () => Date,
    @Inject(MEMBERSHIP_INVITATION_TOKEN)
    private readonly tokenGenerator: () => string,
  ) {}

  listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return this.repository.listWorkspaces(userId);
  }

  async listMembers(context: TenantContext, page: MemberPageQuery) {
    this.assertAdmin(context);
    return await this.repository.withTenant(context, (store) =>
      store.listMembers(page),
    );
  }

  listInvitations(context: TenantContext, page: InvitationPageQuery) {
    this.assertAdmin(context);
    return this.repository.withTenant(context, (store) =>
      store.listInvitations(page),
    );
  }

  async invite(
    context: TenantContext,
    input: { phone: string; role: MemberRole; requestId: string; ip?: string },
  ) {
    this.assertAdmin(context);
    const targetPhone = normalizeChineseMobile(input.phone);
    return await this.repository.withTenant(context, async (store) => {
      const invitation = await store.createInvitation({
        tenantId: context.tenantId,
        targetPhone,
        role: input.role,
        invitationCodeHash: createHash('sha256')
          .update(this.tokenGenerator())
          .digest('hex'),
        createdByUserId: context.userId,
        expiresAt: new Date(this.clock().getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'invitation.created',
        resourceType: 'tenant_invitation',
        resourceId: invitation.id,
        after: { role: input.role },
        requestId: input.requestId,
        ip: input.ip,
      });
      return invitation;
    });
  }

  async changeMemberStatus(
    context: TenantContext,
    memberId: string,
    status: 'ACTIVE' | 'DISABLED',
    meta: { requestId: string; ip?: string },
  ) {
    this.assertAdmin(context);
    return await this.repository.withTenant(context, async (store) => {
      await store.lockAdminRoster();
      const member = await store.findMember(memberId);
      if (!member) throw new ApiException('MEMBERSHIP_INACTIVE', 404);
      if (
        status === 'DISABLED' &&
        member.role === 'TENANT_ADMIN' &&
        (await store.countActiveAdmins()) <= 1
      ) {
        throw new ApiException('TENANT_ADMIN_REQUIRED', 409);
      }
      const changed = await store.updateMemberStatus(memberId, status);
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'membership.status_changed',
        resourceType: 'tenant_member',
        resourceId: memberId,
        before: { status: member.status },
        after: { status },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return changed;
    });
  }

  async listMemberObjectAccess(
    context: TenantContext,
    memberId: string,
  ): Promise<MemberObjectAccess[]> {
    this.assertAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await requireActiveEmployee(store, memberId);
      const objects = await store.listPublishedObjectAccess(memberId);
      return objects.map(resolveMemberObjectAccess);
    });
  }

  async setMemberObjectAccess(
    context: TenantContext,
    memberId: string,
    objectId: string,
    input: MemberObjectAccessInput,
    meta: { requestId: string; ip?: string },
  ): Promise<MemberObjectAccess> {
    this.assertAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await requireActiveEmployee(store, memberId);
      const objects = await store.listPublishedObjectAccess(memberId);
      const object = objects.find(
        (candidate) => candidate.objectId === objectId,
      );
      if (!object) throw new ApiException('OBJECT_NOT_FOUND', 404);
      const before = resolveMemberObjectAccess(object);

      if (input.mode === 'INHERIT') {
        await store.deleteMemberObjectAccess(memberId, objectId);
        object.override = null;
      } else {
        const override: MemberObjectPolicy = {
          canCreate: input.canCreate,
          canRead: input.canRead,
          canUpdate: input.canUpdate,
          canDelete: false,
          readScope: input.readScope,
          updateScope: input.updateScope,
        };
        await store.replaceMemberObjectAccess(memberId, objectId, override);
        object.override = override;
      }

      const after = resolveMemberObjectAccess(object);
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'membership.object_access_changed',
        resourceType: 'object_permission',
        resourceId: objectId,
        before: accessAuditValue(memberId, before),
        after: accessAuditValue(memberId, after),
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return after;
    });
  }

  async resendInvitation(
    context: TenantContext,
    invitationId: string,
    meta: { requestId: string; ip?: string },
  ) {
    this.assertAdmin(context);
    return await this.repository.withTenant(context, async (store) => {
      const invitation = await store.findInvitation(invitationId);
      if (!invitation || invitation.status !== 'PENDING') {
        throw new ApiException('INVITATION_NOT_FOUND', 404);
      }
      const expiresAt = new Date(
        this.clock().getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      await store.updateInvitation(invitationId, {
        invitationCodeHash: createHash('sha256')
          .update(this.tokenGenerator())
          .digest('hex'),
        expiresAt,
      });
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'invitation.resent',
        resourceType: 'tenant_invitation',
        resourceId: invitationId,
        after: { expiresAt: expiresAt.toISOString() },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return { accepted: true, expiresAt };
    });
  }

  async revokeInvitation(
    context: TenantContext,
    invitationId: string,
    meta: { requestId: string; ip?: string },
  ) {
    this.assertAdmin(context);
    return await this.repository.withTenant(context, async (store) => {
      const invitation = await store.findInvitation(invitationId);
      if (!invitation || invitation.status !== 'PENDING') {
        throw new ApiException('INVITATION_NOT_FOUND', 404);
      }
      await store.updateInvitation(invitationId, { status: 'REVOKED' });
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'invitation.revoked',
        resourceType: 'tenant_invitation',
        resourceId: invitationId,
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return { accepted: true };
    });
  }

  private assertAdmin(context: TenantContext): void {
    if (context.role !== 'TENANT_ADMIN') {
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    }
  }
}

async function requireActiveEmployee(
  store: MembershipStore,
  memberId: string,
): Promise<TenantMemberSummary> {
  const member = await store.findMember(memberId);
  if (!member || member.status !== 'ACTIVE' || member.role !== 'EMPLOYEE') {
    throw new ApiException('MEMBERSHIP_INACTIVE', 404);
  }
  return member;
}

function resolveMemberObjectAccess(
  source: MemberObjectAccessSource,
): MemberObjectAccess {
  return {
    ...source,
    mode: source.override ? 'OVERRIDE' : 'INHERIT',
    effective: source.override ?? source.inherited,
  };
}

function accessAuditValue(
  memberId: string,
  access: MemberObjectAccess,
): Record<string, unknown> {
  return {
    memberId,
    mode: access.mode,
    policy: access.override,
  };
}
