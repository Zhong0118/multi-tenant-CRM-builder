import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import { normalizeChineseMobile } from '../auth/phone-number';

export const PLATFORM_TENANT_REPOSITORY = Symbol('PLATFORM_TENANT_REPOSITORY');
export const TENANT_CLOCK = Symbol('TENANT_CLOCK');
export const INVITATION_TOKEN_GENERATOR = Symbol('INVITATION_TOKEN_GENERATOR');

export type TenantStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export interface TenantPageQuery {
  status?: TenantStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface PlatformTenant {
  id: string;
  name: string;
  code: string;
  status: TenantStatus;
  timezone?: string;
  locale?: string;
  activatedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  activeAdminCount: number;
  firstAdminInvitation?: {
    id: string;
    targetPhone: string;
    role: 'TENANT_ADMIN';
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
    expiresAt: Date;
  };
}

export interface PlatformTenantPage {
  items: PlatformTenant[];
  page: number;
  limit: number;
  total: number;
}

export interface PlatformTenantSummary {
  total: number;
  draft: number;
  active: number;
  suspended: number;
  closed: number;
}

export interface PlatformTenantStore {
  createTenant(input: { name: string; code: string }): Promise<PlatformTenant>;
  enterTenant(tenantId: string): Promise<void>;
  createFirstAdminInvitation(input: {
    tenantId: string;
    targetPhone: string;
    invitationCodeHash: string;
    createdByUserId: string;
    expiresAt: Date;
    role: 'TENANT_ADMIN';
  }): Promise<{
    id: string;
    targetPhone: string;
    role: 'TENANT_ADMIN';
    status: 'PENDING';
    expiresAt: Date;
  }>;
  renewFirstAdminInvitation(
    id: string,
    input: { invitationCodeHash: string; expiresAt: Date },
  ): Promise<void>;
  revokeFirstAdminInvitation(id: string): Promise<void>;
  countActiveAdmins(tenantId: string): Promise<number>;
  findTenant(id: string, lock?: boolean): Promise<PlatformTenant | null>;
  listTenants(page: TenantPageQuery): Promise<PlatformTenantPage>;
  countTenantsByName(name: string): Promise<number>;
  updateTenantStatus(id: string, status: TenantStatus): Promise<PlatformTenant>;
  appendAudit(event: AuditEvent): Promise<void>;
  summarizeTenants(): Promise<PlatformTenantSummary>;
}

export interface PlatformTenantRepository {
  transaction<T>(
    actorId: string,
    work: (store: PlatformTenantStore) => Promise<T>,
  ): Promise<T>;
  list(actorId: string, page: TenantPageQuery): Promise<PlatformTenantPage>;
  find(actorId: string, tenantId: string): Promise<PlatformTenant | null>;
  summarize(actorId: string): Promise<PlatformTenantSummary>;
  countNameConflicts(actorId: string, name: string): Promise<number>;
}

@Injectable()
export class TenantsService {
  constructor(
    @Inject(PLATFORM_TENANT_REPOSITORY)
    private readonly repository: PlatformTenantRepository,
    @Inject(TENANT_CLOCK) private readonly clock: () => Date,
    @Inject(INVITATION_TOKEN_GENERATOR)
    private readonly tokenGenerator: () => string,
  ) {}

  async createTenant(
    actor: AuthenticatedUser,
    input: {
      name: string;
      code: string;
      firstAdminPhone: string;
      requestId: string;
      ip?: string;
    },
  ): Promise<PlatformTenant> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.code)) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { code: ['仅支持小写字母、数字和单个连字符。'] },
      });
    }
    const targetPhone = normalizeChineseMobile(input.firstAdminPhone);

    return await this.repository.transaction(actor.id, async (store) => {
      const tenant = await store.createTenant({
        name: input.name,
        code: input.code,
      });
      await store.enterTenant(tenant.id);
      const firstAdminInvitation = await store.createFirstAdminInvitation({
        tenantId: tenant.id,
        targetPhone,
        invitationCodeHash: sha256(this.tokenGenerator()),
        createdByUserId: actor.id,
        expiresAt: new Date(this.clock().getTime() + 7 * 24 * 60 * 60 * 1000),
        role: 'TENANT_ADMIN',
      });
      await store.appendAudit({
        tenantId: tenant.id,
        actorType: 'USER',
        actorId: actor.id,
        action: 'platform.tenant.created',
        resourceType: 'tenant',
        resourceId: tenant.id,
        after: { name: tenant.name, code: tenant.code, status: tenant.status },
        requestId: input.requestId,
        ip: input.ip,
      });
      return { ...tenant, activeAdminCount: 0, firstAdminInvitation };
    });
  }

  list(
    actor: AuthenticatedUser,
    page: TenantPageQuery,
  ): Promise<PlatformTenantPage> {
    return this.repository.list(actor.id, page);
  }

  summarize(actor: AuthenticatedUser): Promise<PlatformTenantSummary> {
    return this.repository.summarize(actor.id);
  }

  async countNameConflicts(
    actor: AuthenticatedUser,
    name: string,
  ): Promise<{ name: string; count: number }> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { name: ['请输入公司名称。'] },
      });
    }
    return {
      name: trimmed,
      count: await this.repository.countNameConflicts(actor.id, trimmed),
    };
  }

  async detail(
    actor: AuthenticatedUser,
    tenantId: string,
  ): Promise<PlatformTenant> {
    const tenant = await this.repository.find(actor.id, tenantId);
    if (!tenant) throw new ApiException('TENANT_NOT_FOUND', 404);
    return tenant;
  }

  renewFirstAdminInvitation(
    actor: AuthenticatedUser,
    tenantId: string,
    meta: { requestId: string; ip?: string },
  ): Promise<PlatformTenant> {
    return this.repository.transaction(actor.id, async (store) => {
      const tenant = await store.findTenant(tenantId, true);
      if (!tenant) throw new ApiException('TENANT_NOT_FOUND', 404);
      if (tenant.status !== 'DRAFT') {
        throw new ApiException('TENANT_STATUS_TRANSITION_INVALID', 409);
      }
      const invitation = tenant.firstAdminInvitation;
      if (!invitation) throw new ApiException('INVITATION_NOT_FOUND', 404);
      if (tenant.activeAdminCount > 0 || invitation.status === 'ACCEPTED') {
        throw new ApiException('INVITATION_CONFLICT', 409);
      }
      const expiresAt = new Date(
        this.clock().getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      await store.renewFirstAdminInvitation(invitation.id, {
        invitationCodeHash: sha256(this.tokenGenerator()),
        expiresAt,
      });
      await store.appendAudit({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        action: 'platform.tenant.admin_invitation_renewed',
        resourceType: 'tenant_invitation',
        resourceId: invitation.id,
        before: { status: invitation.status },
        after: { status: 'PENDING', expiresAt: expiresAt.toISOString() },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return {
        ...tenant,
        firstAdminInvitation: { ...invitation, status: 'PENDING', expiresAt },
      };
    });
  }

  async correctFirstAdminPhone(
    actor: AuthenticatedUser,
    tenantId: string,
    phone: string,
    meta: { requestId: string; ip?: string },
  ): Promise<PlatformTenant> {
    const targetPhone = normalizeChineseMobile(phone);
    return this.repository.transaction(actor.id, async (store) => {
      const tenant = await store.findTenant(tenantId, true);
      if (!tenant) throw new ApiException('TENANT_NOT_FOUND', 404);
      if (tenant.status !== 'DRAFT')
        throw new ApiException('TENANT_STATUS_TRANSITION_INVALID', 409);
      const previous = tenant.firstAdminInvitation;
      if (!previous) throw new ApiException('INVITATION_NOT_FOUND', 404);
      if (tenant.activeAdminCount > 0 || previous.status === 'ACCEPTED')
        throw new ApiException('INVITATION_CONFLICT', 409);
      await store.revokeFirstAdminInvitation(previous.id);
      const invitation = await store.createFirstAdminInvitation({
        tenantId,
        targetPhone,
        role: 'TENANT_ADMIN',
        createdByUserId: actor.id,
        invitationCodeHash: sha256(this.tokenGenerator()),
        expiresAt: new Date(this.clock().getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      await store.appendAudit({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        action: 'platform.tenant.admin_phone_corrected',
        resourceType: 'tenant_invitation',
        resourceId: invitation.id,
        before: {
          invitationId: previous.id,
          targetPhone: previous.targetPhone,
        },
        after: { invitationId: invitation.id, targetPhone },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return { ...tenant, firstAdminInvitation: invitation };
    });
  }

  changeStatus(
    actor: AuthenticatedUser,
    tenantId: string,
    status: TenantStatus,
    meta: { requestId: string; ip?: string; reason?: string },
  ): Promise<PlatformTenant> {
    return this.repository.transaction(actor.id, async (store) => {
      const before = await store.findTenant(tenantId, true);
      if (!before) throw new ApiException('TENANT_NOT_FOUND', 404);
      if (!canTransition(before.status, status)) {
        throw new ApiException('TENANT_STATUS_TRANSITION_INVALID', 409);
      }
      await store.enterTenant(tenantId);
      if (
        status === 'ACTIVE' &&
        (await store.countActiveAdmins(tenantId)) < 1
      ) {
        throw new ApiException('TENANT_ADMIN_REQUIRED', 409);
      }
      const after = await store.updateTenantStatus(tenantId, status);
      await store.appendAudit({
        tenantId,
        actorType: 'USER',
        actorId: actor.id,
        action: 'platform.tenant.status_changed',
        resourceType: 'tenant',
        resourceId: tenantId,
        before: { status: before.status },
        after: { status: after.status },
        reason: meta.reason,
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return after;
    });
  }
}

function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  if (from === to) return true;
  if (from === 'CLOSED') return false;
  if (to === 'CLOSED') return true;
  if (from === 'DRAFT') return to === 'ACTIVE';
  if (from === 'ACTIVE') return to === 'SUSPENDED';
  return from === 'SUSPENDED' && to === 'ACTIVE';
}

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
