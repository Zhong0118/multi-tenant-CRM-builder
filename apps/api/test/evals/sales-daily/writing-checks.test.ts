import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WritingOptions } from '@crm/contracts';
import { writingChecks } from './writing-checks';

const facts = [{ id: 'F2', text: '财务还在核对交接清单' }];
const options: WritingOptions = {
  kind: 'visit',
  purpose: 'payment',
  tone: 'formal',
  length: 'short',
};
const blocks = (...text: string[]) =>
  text.map((s) => ({ text: s, factRefs: ['F2'] }));
test('visit requests and invented ownership fail the evaluation even if the final draft removes them', () => {
  const raw = {
    blocks: blocks('烦请确认哪一天方便安排。', '贵司财务还在核对交接清单。'),
  };
  const output = {
    kind: 'visit' as const,
    blocks: blocks('签字流程还有哪些待办？'),
  };
  assert.deepEqual(writingChecks(raw, output, options, facts), {
    visitInternal: false,
    neutralAttribution: false,
    lengthOk: true,
  });
});
test('checks message sentences even in one paragraph and excludes email greeting and signature', () => {
  const draft = {
    kind: 'message' as const,
    blocks: blocks('你好。想约个时间。聊聊进展。方便吗？'),
  };
  assert.equal(
    writingChecks(draft, draft, { ...options, kind: 'message' }, facts)
      .lengthOk,
    false,
  );
  const email = {
    kind: 'email' as const,
    blocks: blocks(
      '尊敬的吴经理：',
      '财务还在核对交接清单。',
      '还需要哪些信息？',
      '此致',
      '敬礼！',
      '【姓名】',
    ),
  };
  assert.equal(
    writingChecks(email, email, { ...options, kind: 'email' }, facts).lengthOk,
    true,
  );
});
