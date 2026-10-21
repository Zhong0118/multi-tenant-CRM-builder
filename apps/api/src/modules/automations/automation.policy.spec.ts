import {
  matchesFieldChange,
  validateAutomationRules,
} from './automation.policy';

const rule = {
  key: 'create-order',
  label: '开单',
  enabled: true,
  allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
  trigger: { type: 'FIELD_CHANGED', fieldKey: 'stage', equals: 'won' },
  targetObjectCode: 'order',
  owner: 'ACTOR',
  mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
};

describe('cross-table rule contract', () => {
  it('fires only when crossing into the matching value', () => {
    const [normalized] = validateAutomationRules([rule], 'customer', [
      'name',
      'stage',
    ]);
    expect(
      matchesFieldChange(normalized, { stage: 'new' }, { stage: 'won' }),
    ).toBe(true);
    expect(
      matchesFieldChange(
        normalized,
        { stage: 'won' },
        { stage: 'won', name: 'changed' },
      ),
    ).toBe(false);
    expect(
      matchesFieldChange(normalized, { stage: 'won' }, { stage: 'new' }),
    ).toBe(false);
  });
  it('rejects implicit manual inputs in automatic rules', () => {
    expect(() =>
      validateAutomationRules(
        [{ ...rule, mappings: { amount: { source: 'INPUT' } } }],
        'customer',
        ['name', 'stage'],
      ),
    ).toThrow();
  });
  it('rejects self-targets, missing source fields and duplicate stable keys', () => {
    expect(() =>
      validateAutomationRules(
        [{ ...rule, targetObjectCode: 'customer' }],
        'customer',
        ['name', 'stage'],
      ),
    ).toThrow();
    expect(() =>
      validateAutomationRules([rule], 'customer', ['stage']),
    ).toThrow();
    expect(() =>
      validateAutomationRules([rule, rule], 'customer', ['name', 'stage']),
    ).toThrow();
  });
  it('accepts multi-select literal keys and manual inputs', () => {
    const result = validateAutomationRules(
      [
        {
          ...rule,
          trigger: { type: 'MANUAL' },
          mappings: {
            tags: { source: 'LITERAL', value: ['a', 'b'] },
            amount: { source: 'INPUT' },
          },
        },
      ],
      'customer',
      ['name'],
    );
    expect(result[0].mappings.tags).toEqual({
      source: 'LITERAL',
      value: ['a', 'b'],
    });
  });
});
