const test = require('node:test');
const assert = require('node:assert/strict');
const { pairEvidence, injectionHits } = require('./metrics.cjs');
const { bulkReviewed } = require('./score.cjs');

test('neither model output variability nor equal local fallbacks substitute for guarded wire inputs', () => {
  const attempt = (output) => ({
    calls: 1,
    entries: 1,
    wireDigest: 'wire',
    wireScanned: true,
    privacy: [],
    modelOutputDigest: output,
    outputDigest: output,
  });
  const pair = ['A', 'B'].map((id) => ({
    id,
    pair: 'p',
    ...attempt('first'),
    repeats: [attempt(id), attempt('third')],
  }));
  assert.deepEqual(pairEvidence(pair), {
    pass: true,
    rounds: 3,
    modelEqual: 2,
    localEqual: 2,
  });
  pair[0].repeats[1].wireDigest = 'changed';
  assert.equal(pairEvidence(pair).pass, false);
  pair[0].repeats[1] = { calls: 0, entries: 1, privacy: [] };
  assert.equal(pairEvidence(pair).pass, false);
});

test('scans both ordinary and nested wire strings for raw protected cells', () => {
  const sample = 'synthetic "quoted" cell\nwith a newline';
  const wire = {
    input: [{ content: [{ text: JSON.stringify({ value: sample }) }] }],
  };
  assert.deepEqual(injectionHits(wire, [sample]), ['protectedCell']);
  assert.deepEqual(injectionHits({ input: 'neutral' }, [sample]), []);
});

test('bulk blanking requires a correctly mapped column and unanimous explicit null labels', () => {
  const field = {
    fieldKey: 'tier',
    type: 'SINGLE_SELECT',
    config: { options: [] },
  };
  const base = { mapping: ['tier'], valueChoices: {} };
  const parsed = { rows: [['a'], ['b'], ['a']] };
  const col = {
    target: { mode: 'field', field: 'tier' },
    values: [{ raw: 'a', option: null }],
  };
  const answer = { headerRow: 1, columns: [col] };
  const apply = () => bulkReviewed(base, parsed, 1, [field], answer);
  assert.deepEqual(apply().mapping, base.mapping);
  assert.deepEqual(apply().valueChoices, {});
  col.values.push({ raw: 'b', option: null });
  assert.deepEqual(
    [...apply().valueChoices[0]],
    [
      ['a', null],
      ['b', null],
    ],
  );
  col.target.field = 'other';
  assert.deepEqual(apply().valueChoices, {});
});
