import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';

export const POOL_STAGES = [
  'LEAD_POOL',
  'CUSTOMER_POOL',
  'PENDING_CONTACT',
  'FOLLOWING',
  'PROTECTED',
] as const;
export type PoolStage = (typeof POOL_STAGES)[number];
export type PoolOrigin = 'LEAD_POOL' | 'CUSTOMER_POOL';
export type PoolQuality = 'INVALID' | 'DUPLICATE' | 'LOST';
export type PoolLabels = {
  leadPool: string;
  customerPool: string;
  pending: string;
  following: string;
  protected: string;
};
export type PoolProtectionRule = {
  sourceObjectCode: string;
  statusKeys: string[];
};
export interface PoolConfig {
  enabled: boolean;
  lifecycleEnabled?: boolean;
  contactTtlHours?: number;
  followUpTtlHours?: number;
  labels?: Partial<PoolLabels>;
  protectionRules?: PoolProtectionRule[];
  ownershipTtlHours: number | null;
  version: number;
}
export interface OwnershipInput {
  action:
    'CLAIM' | 'RELEASE' | 'ASSIGN' | 'CONFIRM_CONTACT' | 'UNPROTECT_RELEASE';
  reason?: string;
  quality?: PoolQuality;
  poolStage?: PoolOrigin;
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
    poolStage?: string | null;
    poolOrigin?: string | null;
    ownershipExpiresAt?: Date | string | null;
  },
  input: OwnershipInput,
  now: Date,
): {
  ownerMemberId: string | null;
  inPublicPool: boolean;
  ownershipExpiresAt: Date | null;
  poolStage?: PoolStage | null;
  poolOrigin?: PoolOrigin | null;
  poolClaimedAt?: Date | null;
  poolLastFollowUpAt?: Date | null;
  poolProtectedAt?: Date | null;
  poolReason?: string | null;
  poolQuality?: PoolQuality | null;
  protectionNeedsReview?: boolean;
} {
  if (
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    ![
      'CLAIM',
      'RELEASE',
      'ASSIGN',
      'CONFIRM_CONTACT',
      'UNPROTECT_RELEASE',
    ].includes(input.action) ||
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
  if (config.lifecycleEnabled) {
    if (
      input.quality !== undefined &&
      !['INVALID', 'DUPLICATE', 'LOST'].includes(input.quality)
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    if (
      input.poolStage !== undefined &&
      (!admin ||
        !['LEAD_POOL', 'CUSTOMER_POOL'].includes(input.poolStage) ||
        record.poolStage ||
        input.action !== 'RELEASE')
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    if (
      input.action === 'CLAIM' &&
      !['LEAD_POOL', 'CUSTOMER_POOL'].includes(record.poolStage ?? '')
    )
      throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
        message: '旧记录需由管理员显式归类后才能领取。',
      });
    if (input.action === 'CONFIRM_CONTACT') {
      if (!admin && record.ownerMemberId !== context.memberId)
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (
        record.poolStage !== 'PENDING_CONTACT' ||
        !record.ownerMemberId ||
        !record.ownershipExpiresAt ||
        new Date(record.ownershipExpiresAt).getTime() <= now.getTime()
      )
        throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
          message: '联系期限已到或记录状态已变，请刷新。',
        });
      return {
        ownerMemberId: record.ownerMemberId,
        inPublicPool: false,
        poolStage: 'FOLLOWING',
        poolLastFollowUpAt: now,
        ownershipExpiresAt: ownershipDeadline(
          config.followUpTtlHours ?? 720,
          now,
        ),
      };
    }
    if (input.action === 'RELEASE' || input.action === 'UNPROTECT_RELEASE') {
      if (!admin && record.ownerMemberId !== context.memberId)
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (
        typeof input.reason !== 'string' ||
        !input.reason.trim() ||
        input.reason.length > 1000
      )
        throw new ApiException('VALIDATION_FAILED', 400);
      if (
        input.action === 'UNPROTECT_RELEASE'
          ? !admin || record.poolStage !== 'PROTECTED'
          : record.poolStage === 'PROTECTED'
      )
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (!record.poolStage && (!admin || !input.poolStage))
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '请选择旧记录要进入的公共池。',
        });
      if (record.poolStage && record.inPublicPool)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      const destination =
        input.poolStage ??
        (record.poolStage === 'PENDING_CONTACT'
          ? record.poolOrigin === 'CUSTOMER_POOL'
            ? 'CUSTOMER_POOL'
            : 'LEAD_POOL'
          : 'CUSTOMER_POOL');
      return {
        ownerMemberId: null,
        inPublicPool: true,
        ownershipExpiresAt: null,
        poolStage: destination,
        poolOrigin: destination,
        poolReason: input.reason.trim(),
        ...(input.quality ? { poolQuality: input.quality } : {}),
        poolProtectedAt: null,
        protectionNeedsReview: false,
      };
    }
    if (record.poolStage === 'PROTECTED')
      return {
        ownerMemberId: input.ownerMemberId!,
        inPublicPool: false,
        ownershipExpiresAt: null,
        poolStage: 'PROTECTED',
      };
    return {
      ownerMemberId:
        input.action === 'CLAIM' ? context.memberId : input.ownerMemberId!,
      inPublicPool: false,
      poolStage: 'PENDING_CONTACT',
      poolOrigin:
        record.poolStage === 'LEAD_POOL'
          ? 'LEAD_POOL'
          : record.poolStage === 'CUSTOMER_POOL' ||
              record.poolOrigin === 'CUSTOMER_POOL' ||
              record.poolStage === 'FOLLOWING'
            ? 'CUSTOMER_POOL'
            : 'LEAD_POOL',
      poolClaimedAt: now,
      poolLastFollowUpAt: null,
      ownershipExpiresAt: ownershipDeadline(config.contactTtlHours ?? 24, now),
    };
  }
  if (
    input.action === 'CONFIRM_CONTACT' ||
    input.action === 'UNPROTECT_RELEASE' ||
    input.poolStage !== undefined
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
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
