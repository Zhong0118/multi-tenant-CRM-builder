import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';

export interface PoolConfig {
  enabled: boolean;
  ownershipTtlHours: number | null;
  version: number;
}
export interface OwnershipInput {
  action: 'CLAIM' | 'RELEASE' | 'ASSIGN';
  version: number;
  ownerMemberId?: string;
}
export function ownershipChange(
  context: TenantContext,
  access: EffectiveObjectAccess,
  config: PoolConfig,
  record: {
    ownerMemberId: string | null;
    inPublicPool: boolean;
    version: number;
  },
  input: OwnershipInput,
  now: Date,
): {
  ownerMemberId: string | null;
  inPublicPool: boolean;
  ownershipExpiresAt: Date | null;
} {
  if (
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    !['CLAIM', 'RELEASE', 'ASSIGN'].includes(input.action) ||
    (input.action === 'ASSIGN'
      ? !input.ownerMemberId
      : input.ownerMemberId !== undefined)
  ) {
    throw new ApiException('VALIDATION_FAILED', 400);
  }
  const admin = context.role === 'TENANT_ADMIN';
  if (
    !access.canRead ||
    access.readScope === 'NONE' ||
    !access.canUpdate ||
    access.updateScope === 'NONE'
  ) {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
  if (
    !admin &&
    access.readScope === 'OWN' &&
    !record.inPublicPool &&
    record.ownerMemberId !== context.memberId
  ) {
    throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  if (record.version !== input.version)
    throw new ApiException('RECORD_VERSION_CONFLICT', 409);
  if (input.action !== 'ASSIGN' && !config.enabled) {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403, {
      message: '该业务表已关闭公共池，请刷新页面。',
    });
  }
  if (input.action === 'ASSIGN' && !admin)
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  if (
    input.action === 'CLAIM' &&
    (!record.inPublicPool || record.ownerMemberId !== null)
  ) {
    throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
      message: '记录已被领取或不在公共池，请刷新列表。',
    });
  }
  if (input.action === 'RELEASE') {
    if (!admin && record.ownerMemberId !== context.memberId)
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    if (record.inPublicPool)
      throw new ApiException('RECORD_VERSION_CONFLICT', 409);
    return {
      ownerMemberId: null,
      inPublicPool: true,
      ownershipExpiresAt: null,
    };
  }
  return {
    ownerMemberId:
      input.action === 'CLAIM' ? context.memberId : input.ownerMemberId!,
    inPublicPool: false,
    ownershipExpiresAt: ownershipDeadline(config.ownershipTtlHours, now),
  };
}

export function ownershipDeadline(
  hours: number | null,
  now: Date,
): Date | null {
  return hours === null ? null : new Date(now.getTime() + hours * 3_600_000);
}
