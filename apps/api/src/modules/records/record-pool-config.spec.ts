import { validatePoolConfig } from './record-pool-config';
describe('pool config validation', () => {
  const base = {
    enabled: true,
    ownershipTtlHours: null,
    version: 1,
    lifecycleEnabled: true,
    contactTtlHours: 24,
    followUpTtlHours: 720,
  };
  it('accepts generic optional published source selections', () =>
    expect(() =>
      validatePoolConfig({
        ...base,
        protectionRules: [
          { sourceObjectCode: 'agreements', statusKeys: ['signed'] },
        ],
      }),
    ).not.toThrow());
  it.each([
    { contactTtlHours: 0 },
    { followUpTtlHours: 8761 },
    { labels: { pending: '' } },
    { protectionRules: [{ sourceObjectCode: 'orders', statusKeys: [] }] },
    { lifecycleEnabled: 'yes' },
  ])('rejects invalid configuration %j', (change) =>
    expect(() => validatePoolConfig({ ...base, ...change } as never)).toThrow(),
  );
});
