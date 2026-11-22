import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FilterRule } from '@crm/contracts';
import type { RecordsStore } from '../../../src/modules/records/records.repository';
import { parseListFilters } from '../../../src/modules/records/record-filter';
import { actor, now, objects, store, zone } from './fixture';
import { evaluate, blocksDelivery, securityChecks, readDataset } from './run';
import { score, type Sample } from './score';

const owner = { fieldKey: '$owner', operator: 'in', value: ['$me'] } as const;
const quoted = {
  fieldKey: 'stage',
  operator: 'in',
  value: ['quote', 'negotiation'],
} as const;
const base: FilterRule = { version: 1, match: 'all', conditions: [] };
const sample: Sample = {
  id: 'test',
  category: '权限',
  text: '请筛选客户',
  currentRule: base,
  expected: { kind: 'unavailable' },
};

void test('scoring ignores only commutative ordering', () => {
  const rule: FilterRule = {
    ...base,
    conditions: [
      { ...owner, value: ['$me'] },
      { ...quoted, value: [...quoted.value] },
    ],
  };
  const expected = { kind: 'rule' as const, rule };
  const swapped: FilterRule = {
    ...base,
    conditions: [
      { ...quoted, value: ['negotiation', 'quote'] },
      { ...owner, value: ['$me'] },
    ],
  };
  assert.deepEqual(score({ expected }, { kind: 'rule', rule: swapped }), []);
  assert.ok(
    score({ expected }, { kind: 'rule', rule: { ...swapped, match: 'any' } })
      .length,
  );
  for (const [want, got] of [
    ['100', 100],
    ['today', 'yesterday'],
  ]) {
    const term = {
      fieldKey: want === '100' ? 'amount' : 'contacted',
      operator: want === '100' ? ('gt' as const) : ('relative' as const),
    };
    assert.ok(
      score(
        {
          expected: {
            kind: 'rule',
            rule: { ...base, conditions: [{ ...term, value: want }] },
          },
        },
        {
          kind: 'rule',
          rule: { ...base, conditions: [{ ...term, value: got }] },
        },
      ).length,
    );
  }
});

void test('clarification requires every full alternative and distinct visible choices', () => {
  const rules: FilterRule[] = ['past_7_days', 'past_30_days'].map((p) => ({
    ...base,
    conditions: [
      { ...owner, value: ['$me'] },
      { fieldKey: 'contacted', operator: 'relative', value: p },
    ],
  }));
  const expected = { kind: 'clarify' as const, candidates: rules };
  const options = rules.map((value, i) => ({
    value,
    id: String(i),
    label: ['近七天', '近三十天'][i],
  }));
  assert.deepEqual(
    score({ expected }, { kind: 'clarify', options: [...options].reverse() }),
    [],
  );
  assert.ok(
    score(
      { expected },
      {
        kind: 'clarify',
        options: [options[0], { ...options[1], label: options[0].label }],
      },
    ).length,
  );
  assert.ok(
    score(
      { expected },
      {
        kind: 'clarify',
        options: [
          options[0],
          {
            ...options[1],
            value: { ...base, conditions: rules[1].conditions.slice(1) },
          },
        ],
      },
    ).length,
  );
});

void test('model faults cannot earn permission or abstention credit', async () => {
  const [fault] = await evaluate(
    () => Promise.reject(new Error('offline')),
    [sample],
  );
  assert.ok(fault.failures.length);
  assert.equal(blocksDelivery(fault), true);
  const [abstained] = await evaluate(
    () => Promise.resolve({ rules: [] }),
    [sample],
  );
  assert.deepEqual(abstained.failures, []);
  assert.equal(abstained.audit.fault, false);
  for (const category of ['restricted', '隐藏字段及越权的系统条件']) {
    assert.ok(
      blocksDelivery({
        ...abstained,
        sample: { ...sample, category },
        failures: ['应拒绝但返回了条件'],
      }),
    );
  }
});

void test('all injected permission violations reject the whole output', async () => {
  const probes = await securityChecks();
  assert.ok(probes.length >= 6);
  for (const row of probes) assert.deepEqual(row.failures, [], row.sample.id);
});

void test('relative preview executes across tenant midnight with the list parser', async () => {
  const rule: FilterRule = {
    ...base,
    conditions: [
      { fieldKey: 'contacted', operator: 'relative', value: 'today' },
    ],
  };
  const [row] = await evaluate(
    () => Promise.resolve({ rules: [rule] }),
    [{ ...sample, expected: { kind: 'rule', rule } }],
  );
  assert.deepEqual(row.failures, []);
  assert.equal(row.draft?.kind, 'rule');
  if (row.draft?.kind !== 'rule') throw new Error('missing preview rule');
  const resolved = await objects.resolveRuntimeSchema(actor, 'customers');
  for (const [instant, day, next] of [
    [new Date(+now - 1), '2026-11-22', '2026-11-23'],
    [now, '2026-11-23', '2026-11-24'],
  ] as const) {
    const filters = await parseListFilters(
      JSON.stringify(row.draft.rule),
      resolved,
      actor,
      store as unknown as RecordsStore,
      instant,
      zone,
    );
    assert.deepEqual(filters, [
      {
        fieldKey: 'contacted',
        mode: 'DATE_RANGE',
        dateType: 'DATE',
        from: day,
        before: next,
      },
    ]);
  }
});

void test('corpus includes the fixed quotas and original frozen holdout', async () => {
  const holdout = await readFile(join(__dirname, 'holdout.json'));
  assert.equal(
    createHash('sha256').update(holdout).digest('hex'),
    'c8e8277dc6ddb4eb1151d2541376d28027033ee9edf67e4a4ee5c85b7981e87f',
  );
  const dev = await readDataset('development');
  assert.equal(dev.length, 20);
  assert.equal(new Set(dev.map((s) => s.id)).size, 20);
  const categories = [...new Set(dev.map((row) => row.category))];
  assert.deepEqual(
    categories.map((cat) => dev.filter((row) => row.category === cat).length),
    [4, 3, 3, 3, 3, 4],
  );
  assert.equal((await readDataset('holdout')).length, 10);
});
