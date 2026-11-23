import { inputs, validated } from './admin.contract';
import { cursorValue, permittedChanges } from './admin-operations';
import { validatePlan } from './admin-platform.service';
import {
  admin,
  previewAllocation,
  usageNotice,
  type Company,
} from './admin-usage';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
const base = {
  tenantId: 'a',
  month: '2026-11-01',
  version: 1,
  planId: 'p',
  planVersion: 2,
  totalTokens: '1000',
  usedTokens: '799',
  percent: 79.9,
} as Company;
const plan = {
  name: '试用',
  description: '',
  monthlyTokens: '10000000',
  assignable: true,
};
const member = (id: string, used: string, active = true) => ({
  memberId: id,
  name: id,
  active,
  usedTokens: used,
  reservedTokens: '0',
});
describe('AI governance contracts and projections', () => {
  it('rejects employee access, identity injection, unknown features, and oversized amounts', () => {
    expect(() => admin({ role: 'EMPLOYEE' } as TenantContext)).toThrow();
    for (const body of [
      { ...plan, features: ['assistant'], tenantId: 'spoof' },
      { ...plan, features: ['secret'] },
      { ...plan, features: [], monthlyTokens: '9223372036854775808' },
    ])
      expect(() => validated(inputs.plan, body)).toThrow();
    expect(() =>
      validatePlan({ ...plan, features: ['write_proposal'] }),
    ).toThrow();
    expect(() =>
      validatePlan({ ...plan, features: ['assistant', 'assistant'] }),
    ).toThrow();
  });
  it('rejects a stale allocation summary after the active roster, plan or month changes', () => {
    const roster = [
      member('a', '0'),
      member('b', '501'),
      member('c', '900', false),
    ];
    const first = previewAllocation(base, roster);
    expect(first).toMatchObject({
      members: 2,
      shareTokens: '500',
      overShare: 1,
    });
    expect(previewAllocation(base, roster.reverse()).confirmation).toBe(
      first.confirmation,
    );
    for (const other of [
      previewAllocation({ ...base, month: '2026-12-01' }, roster),
      previewAllocation({ ...base, planVersion: 3 }, roster),
      previewAllocation(base, [member('new', '0'), member('b', '501')]),
    ])
      expect(other.confirmation).not.toBe(first.confirmation);
    expect(previewAllocation(base, [])).toMatchObject({
      members: 0,
      shareTokens: null,
      overShare: 0,
    });
  });
  it('uses exact company thresholds and returns only the personal budget in equal mode', () => {
    expect(usageNotice(base, null).notice).toBeNull();
    for (const [used, notice] of [
      ['800', 'company_warning'],
      ['999', 'company_warning'],
      ['1000', 'company_exhausted'],
    ])
      expect(usageNotice({ ...base, usedTokens: used }, null).notice).toBe(
        notice,
      );
    expect(usageNotice({ ...base, totalTokens: '0' }, null).percent).toBeNull();
    expect(
      usageNotice(base, { limit: 501n, used: 250n, reserved: 2n }),
    ).toEqual({ notice: 'personal', percent: 49.9, remainingTokens: '249' });
  });
  it('removes unauthorized or unidentified fields from historical differences', () => {
    const snapshot = {
      operationType: 'UPDATE_RECORD',
      changes: [
        { fieldKey: 'visible', label: '姓名', after: '李', internal: 'secret' },
        { fieldKey: 'private', label: '秘密', after: '隐私' },
        { label: '旧值', before: '隐私' },
      ],
    };
    const result = permittedChanges(
      'draft',
      'DRAFT',
      { items: { fields: snapshot } },
      new Set(['visible']),
    );
    expect(result).toEqual({
      complete: false,
      items: [
        {
          operationType: 'UPDATE_RECORD',
          status: 'DRAFT',
          changes: [{ label: '姓名', after: '李' }],
        },
      ],
    });
  });
  it('accepts supported operation-type filters and rejects unknown types', () => {
    expect(
      validated(inputs.operations, { operationType: 'UPDATE_RECORD' }),
    ).toMatchObject({ operationType: 'UPDATE_RECORD' });
    expect(() =>
      validated(inputs.operations, { operationType: 'TRANSFER_OWNER' }),
    ).toThrow();
  });
  it('rejects malformed cursors', () =>
    expect(() =>
      cursorValue(
        Buffer.from('{"time":"tomorrow","id":"x"}').toString('base64url'),
      ),
    ).toThrow());
});
