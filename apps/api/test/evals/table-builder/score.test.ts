import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTablePlan } from './score';
const sample = {
  id: 'policy',
  industry: 'test',
  description: 'x',
  existingObjects: [],
  answers: [],
  mustCover: [
    { entity: '采购', fields: [{ meaning: '联系电话', type: 'PHONE' }] },
  ],
  mustOmit: [],
  permissionCeiling: 'manual-default',
};
void test('counts missing entities rather than rewarding blanket refusal', () => {
  const result = scoreTablePlan(sample, {
    kind: 'blueprint',
    issues: [],
    blueprint: { version: 1, tables: [], assumptions: [], omitted: [] },
  });
  assert.ok(result.some((e) => e.includes('采购')));
});
void test('a question cannot pass an explicit business request', () => {
  assert.ok(
    scoreTablePlan(sample, {
      kind: 'question',
      key: 'industry',
      prompt: '',
      options: [],
    }).length,
  );
});
