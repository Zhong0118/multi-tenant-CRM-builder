import { ApiException } from '../../common/errors/api.exception';
import { ownershipChange, type OwnershipInput } from './record-ownership';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { EffectiveObjectAccess } from '../objects/effective-access';

const employee: TenantContext = {
  tenantId: 'tenant',
  tenantCode: 'test',
  memberId: 'member',
  userId: 'user',
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
const config = { enabled: true, ownershipTtlHours: 2, version: 1 };
const pool = { ownerMemberId: null, inPublicPool: true, version: 3 };
const now = new Date('2026-10-14T00:00:00Z');
const claim: OwnershipInput = { action: 'CLAIM', version: 3 };

describe('record ownership', () => {
  it('does not disclose private OWN-scope records through ownership version conflicts', () => {
    expect(() =>
      ownershipChange(
        employee,
        access,
        config,
        { ...pool, inPublicPool: false, ownerMemberId: 'other' },
        { action: 'CLAIM', version: 1 },
        now,
      ),
    ).toThrow(new ApiException('RECORD_NOT_FOUND', 404));
  });

  it('claims an explicit pool record and starts the current TTL', () => {
    expect(ownershipChange(employee, access, config, pool, claim, now)).toEqual(
      {
        ownerMemberId: 'member',
        inPublicPool: false,
        ownershipExpiresAt: new Date('2026-10-14T02:00:00Z'),
      },
    );
  });
  it('releases only the member’s own record and clears the deadline', () => {
    expect(
      ownershipChange(
        employee,
        access,
        config,
        { ...pool, inPublicPool: false, ownerMemberId: 'member' },
        { action: 'RELEASE', version: 3 },
        now,
      ),
    ).toEqual({
      ownerMemberId: null,
      inPublicPool: true,
      ownershipExpiresAt: null,
    });
  });
  it.each([
    ['legacy unowned', { ...pool, inPublicPool: false }, access, config, claim],
    ['read-only', pool, { ...access, canUpdate: false }, config, claim],
    ['unreadable', pool, { ...access, canRead: false }, config, claim],
    ['disabled', pool, access, { ...config, enabled: false }, claim],
    ['stale version', pool, access, config, { ...claim, version: 2 }],
    [
      'employee assigning',
      pool,
      access,
      config,
      { action: 'ASSIGN', version: 3, ownerMemberId: 'target' },
    ],
    [
      'release another owner with ALL scope',
      { ...pool, inPublicPool: false, ownerMemberId: 'other' },
      { ...access, updateScope: 'ALL' },
      config,
      { action: 'RELEASE', version: 3 },
    ],
    [
      'claim carrying target',
      pool,
      access,
      config,
      { ...claim, ownerMemberId: 'other' },
    ],
  ] as const)('rejects %s', (_label, record, policy, settings, command) => {
    expect(() =>
      ownershipChange(employee, policy, settings, record, command, now),
    ).toThrow(ApiException);
  });
  it('allows admin assignment while pool is disabled, with no TTL when null', () => {
    expect(
      ownershipChange(
        { ...employee, role: 'TENANT_ADMIN' },
        access,
        { ...config, enabled: false, ownershipTtlHours: null },
        pool,
        { action: 'ASSIGN', version: 3, ownerMemberId: 'target' },
        now,
      ),
    ).toEqual({
      ownerMemberId: 'target',
      inPublicPool: false,
      ownershipExpiresAt: null,
    });
  });
  it('requires a target for admin assignment', () => {
    expect(() =>
      ownershipChange(
        { ...employee, role: 'TENANT_ADMIN' },
        access,
        config,
        pool,
        { action: 'ASSIGN', version: 3 },
        now,
      ),
    ).toThrow(ApiException);
  });
});
