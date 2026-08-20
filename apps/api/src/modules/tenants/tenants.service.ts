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
  }): Promise<{ id: string; status: 'PENDING' }>;
  countActiveAdmins(tenantId: string): Promise<number>;
  findTenant(id: string): Promise<PlatformTenant | null>;
  listTenants(): Promise<PlatformTenant[]>;
  updateTenantStatus(id: string, status: TenantStatus): Promise<PlatformTenant>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface PlatformTenantRepository {
  transaction<T>(
    actorId: string,
    work: (store: PlatformTenantStore) => Promise<T>,
  ): Promise<T>;
  list(actorId: string): Promise<PlatformTenant[]>;
  find(actorId: string, tenantId: string): Promise<PlatformTenant | null>;
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
      await store.createFirstAdminInvitation({
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
      return tenant;
    });
  }

  list(actor: AuthenticatedUser): Promise<PlatformTenant[]> {
    return this.repository.list(actor.id);
  }

  async detail(
    actor: AuthenticatedUser,
    tenantId: string,
  ): Promise<PlatformTenant> {
    const tenant = await this.repository.find(actor.id, tenantId);
    if (!tenant) throw new ApiException('TENANT_NOT_FOUND', 404);
    return tenant;
  }

  changeStatus(
    actor: AuthenticatedUser,
    tenantId: string,
    status: TenantStatus,
    meta: { requestId: string; ip?: string; reason?: string },
  ): Promise<PlatformTenant> {
    return this.repository.transaction(actor.id, async (store) => {
      const before = await store.findTenant(tenantId);
      if (!before) throw new ApiException('TENANT_NOT_FOUND', 404);
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

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
