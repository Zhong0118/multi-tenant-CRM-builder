import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommunicationOutput } from '../../../src/modules/ai/communication-draft-generator';
import { cases } from './cases';
import { score } from './score';

function sample(id: string) {
  const found = cases.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
}

void test('requires an explicit follow-up to land on the expected instant with a relevant quotation', () => {
  const c = sample('next-week');
  const out = {
    note: '预算尚待审批，下周联系。',
    followUp: {
      title: '确认预算进展',
      suggestedDate: '2026-11-23T01:00:00.000Z',
      evidence: '下周再联系',
    },
  };
  assert.deepEqual(score(c, out), []);
  for (const bad of [
    { note: out.note },
    { ...out, followUp: { ...out.followUp, suggestedDate: null } },
    {
      ...out,
      followUp: { ...out.followUp, suggestedDate: '2026-11-24T01:00:00.000Z' },
    },
    { ...out, followUp: { ...out.followUp, evidence: '周一打电话' } },
    { ...out, followUp: { ...out.followUp, evidence: '预算还没批' } },
    { ...out, followUp: { ...out.followUp, title: '  ' } },
    { ...out, note: '' },
  ])
    assert.notDeepEqual(score(c, bad), []);
});

void test('accepts either omission or a dateless suggestion for vague contact but rejects an invented date', () => {
  const c = sample('maybe-later');
  const out = {
    note: '客户暂未确定时间。',
    followUp: {
      title: '再确认意向',
      evidence: '最近再说',
      suggestedDate: null,
    },
  };
  assert.deepEqual(score(c, { note: out.note }), []);
  assert.deepEqual(score(c, out), []);
  assert.notDeepEqual(
    score(c, {
      ...out,
      followUp: { ...out.followUp, suggestedDate: '2026-11-23T01:00:00.000Z' },
    }),
    [],
  );
  assert.notDeepEqual(
    score(sample('greeting'), {
      ...out,
      followUp: { ...out.followUp, evidence: '你好' },
    }),
    [],
  );
});

void test('requires business value and evidence for every expected field, regardless of order', () => {
  const c = sample('signed-amount');
  const phase = { fieldKey: 'phase', value: 'won', evidence: '已经签了' };
  const amount = {
    fieldKey: 'amount',
    value: '180000.00',
    evidence: '金额 18 万',
  };
  const out = { note: '已签约，金额十八万元。', fieldChanges: [amount, phase] };
  assert.deepEqual(score(c, out), []);
  for (const fieldChanges of [
    [amount],
    [phase, { ...amount, value: '18.00' }],
    [phase, { ...amount, evidence: '已经签了' }],
    [phase, { ...amount, evidence: '合同金额 18 万' }],
    [
      phase,
      amount,
      { fieldKey: 'ownerMemberId', value: 'someone', evidence: '已经签了' },
    ],
    [phase, phase, amount],
  ])
    assert.notDeepEqual(score(c, { ...out, fieldChanges }), []);
});

void test('every hand-labelled case has a consistent reference output and a bounded, synthetic record context', () => {
  assert.ok(cases.length >= 24);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  const long = sample('long-visit');
  assert.ok(long.text.length >= 3800 && long.text.length <= 4000);
  for (const c of cases) {
    assert.ok(c.text.length > 0 && c.text.length <= 4000, c.id);
    assert.ok(Number.isFinite(Date.parse(c.now)), c.id);
    assert.ok(c.recordContext.values.phase, c.id);
    for (const key of Object.keys(c.expected.fields))
      assert.ok(
        c.fields.some((f) => f.fieldKey === key),
        c.id,
      );
    const reference: CommunicationOutput = {
      note: c.text,
      ...(c.expected.followUp === 'required'
        ? {
            followUp: {
              title: '跟进客户',
              suggestedDate: c.expected.date,
              evidence: c.text,
            },
          }
        : {}),
      fieldChanges: Object.entries(c.expected.fields).map(([fieldKey, f]) => ({
        fieldKey,
        value: f.value,
        evidence: c.text,
      })),
    };
    assert.deepEqual(score(c, reference), [], c.id);
  }
});

void test('a price objection can prompt an undated explanation without changing stage', () => {
  const sampleCase = sample('price-objection');
  const followUp = {
    title: '说明方案差异',
    evidence: '让我把两版方案的差异说明白',
    suggestedDate: null,
  };
  const draft = { note: '客户要求解释差异。', followUp };
  assert.deepEqual(score(sampleCase, draft), []);
  assert.deepEqual(score(sampleCase, { note: draft.note }), []);
  assert.notDeepEqual(
    score(sampleCase, {
      ...draft,
      followUp: { ...followUp, suggestedDate: '2026-11-23T01:00:00Z' },
    }),
    [],
  );
});
