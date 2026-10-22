import {
  ownershipChange,
  type PoolConfig,
  type OwnershipInput,
} from './record-ownership';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';
const actor: TenantContext = {
  tenantId: 't',
  tenantCode: 'test',
  memberId: 'm',
  userId: 'u',
  role: 'EMPLOYEE',
};
const access: EffectiveObjectAccess = {
  canRead: true,
  canUpdate: true,
  canCreate: true,
  canDelete: false,
  readScope: 'OWN',
  updateScope: 'OWN',
  fields: {},
};
const config: PoolConfig = {
  enabled: true,
  ownershipTtlHours: 2,
  version: 1,
  lifecycleEnabled: true,
  contactTtlHours: 24,
  followUpTtlHours: 720,
};
const now = new Date('2026-10-18T00:00:00Z');
const record = {
  ownerMemberId: 'm',
  inPublicPool: false,
  version: 3,
  poolStage: 'PENDING_CONTACT' as const,
  poolOrigin: 'CUSTOMER_POOL' as const,
  ownershipExpiresAt: new Date('2026-10-19T00:00:00Z'),
};
const apply = (input: OwnershipInput, overrides = {}, admin = false) =>
  ownershipChange(
    { ...actor, role: admin ? 'TENANT_ADMIN' : 'EMPLOYEE' },
    access,
    config,
    { ...record, ...overrides },
    input,
    now,
  );
describe('generic pool lifecycle', () => {
  it('claims only explicitly classified pools and records the source deadline', () => {
    expect(
      apply(
        { action: 'CLAIM', version: 3 },
        {
          ownerMemberId: null,
          inPublicPool: true,
          poolStage: 'LEAD_POOL',
          ownershipExpiresAt: null,
        },
      ),
    ).toMatchObject({
      ownerMemberId: 'm',
      poolStage: 'PENDING_CONTACT',
      poolOrigin: 'LEAD_POOL',
      poolClaimedAt: now,
      ownershipExpiresAt: new Date('2026-10-19T00:00:00Z'),
    });
    expect(() =>
      apply(
        { action: 'CLAIM', version: 3 },
        { ownerMemberId: null, inPublicPool: true, poolStage: null },
      ),
    ).toThrow();
  });
  it('confirms contact and starts the follow-up window', () =>
    expect(apply({ action: 'CONFIRM_CONTACT', version: 3 })).toMatchObject({
      poolStage: 'FOLLOWING',
      poolLastFollowUpAt: now,
      ownershipExpiresAt: new Date('2026-11-17T00:00:00Z'),
    }));
  it('rejects confirmation at the deadline even before the scheduled sweep', () =>
    expect(() =>
      apply(
        { action: 'CONFIRM_CONTACT', version: 3 },
        { ownershipExpiresAt: now },
      ),
    ).toThrow());
  it('returns pending contacts to their source and following contacts to customer pool', () => {
    expect(
      apply({ action: 'RELEASE', version: 3, reason: '联系失败' }),
    ).toMatchObject({
      poolStage: 'CUSTOMER_POOL',
      ownerMemberId: null,
      ownershipExpiresAt: null,
      poolReason: '联系失败',
    });
    expect(
      apply(
        { action: 'RELEASE', version: 3, reason: '重复', quality: 'DUPLICATE' },
        { poolStage: 'FOLLOWING', poolOrigin: 'LEAD_POOL' },
      ),
    ).toMatchObject({ poolStage: 'CUSTOMER_POOL', poolQuality: 'DUPLICATE' });
  });
  it('requires a release reason and rejects releasing someone else even with all access', () => {
    expect(() => apply({ action: 'RELEASE', version: 3 })).toThrow();
    expect(() =>
      ownershipChange(
        actor,
        { ...access, readScope: 'ALL', updateScope: 'ALL' },
        config,
        { ...record, ownerMemberId: 'other' },
        { action: 'RELEASE', version: 3, reason: '释放' },
        now,
      ),
    ).toThrow();
  });
  it('preserves protected state when admin transfers and prevents ordinary release', () => {
    expect(
      apply(
        { action: 'ASSIGN', version: 3, ownerMemberId: 'next' },
        { poolStage: 'PROTECTED', ownershipExpiresAt: null },
        true,
      ),
    ).toMatchObject({
      poolStage: 'PROTECTED',
      ownerMemberId: 'next',
      ownershipExpiresAt: null,
    });
    expect(() =>
      apply(
        { action: 'RELEASE', version: 3, reason: '丢单' },
        { poolStage: 'PROTECTED' },
        true,
      ),
    ).toThrow();
  });
  it('allows only administrator explicit unprotect release', () => {
    expect(() =>
      apply(
        { action: 'UNPROTECT_RELEASE', version: 3, reason: '确认解除' },
        { poolStage: 'PROTECTED' },
      ),
    ).toThrow();
    expect(
      apply(
        { action: 'UNPROTECT_RELEASE', version: 3, reason: '确认解除' },
        { poolStage: 'PROTECTED' },
        true,
      ),
    ).toMatchObject({
      poolStage: 'CUSTOMER_POOL',
      poolProtectedAt: null,
      protectionNeedsReview: false,
    });
  });
  it('requires an explicit destination to classify legacy records', () => {
    expect(() =>
      apply(
        { action: 'RELEASE', version: 3, reason: '分类' },
        { poolStage: null },
        true,
      ),
    ).toThrow();
    expect(
      apply(
        {
          action: 'RELEASE',
          version: 3,
          reason: '分类',
          poolStage: 'LEAD_POOL',
        },
        { poolStage: null },
        true,
      ),
    ).toMatchObject({ poolStage: 'LEAD_POOL' });
  });
});
