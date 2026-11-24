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
void test('visit requests and invented ownership fail the evaluation even if the final draft removes them', () => {
  const raw = {
    blocks: blocks('烦请确认哪一天方便安排。', '贵司财务还在核对交接清单。'),
  };
  const output = {
    kind: 'visit' as const,
    blocks: blocks('签字流程还有哪些待办？'),
  };
  assert.deepEqual(writingChecks(raw, output, options, facts), {
    visitInternal: false,
    visitGrounded: false,
    neutralAttribution: false,
    lengthOk: true,
  });
});
void test('checks message sentences even in one paragraph and excludes email greeting and signature', () => {
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
void test('does not score empty or generic visit outlines as grounded, and checks indirect party attribution', () => {
  const output = {
    kind: 'visit' as const,
    blocks: blocks(
      '拜访对象和目的：了解进展',
      '已知情况',
      '要问的问题',
      '本次沟通有哪些事项需要优先确认？',
      '要带的材料',
    ),
  };
  assert.equal(
    Object.values(writingChecks({ blocks: [] }, output, options, facts)).every(
      Boolean,
    ),
    false,
  );
  assert.equal(
    writingChecks(
      { blocks: blocks('目的：我想了解进度') },
      output,
      options,
      facts,
    ).visitInternal,
    false,
  );
  assert.equal(
    writingChecks(
      { blocks: blocks('财务同事正在替我司核对交接清单。') },
      output,
      options,
      facts,
    ).neutralAttribution,
    false,
  );
});

void test('scores the supplied facts and specific questions independently of rendered fallback sections', () => {
  const facts = [
    { id: 'F1', text: '海川' },
    { id: 'F2', text: '客户正在准备审计报告' },
  ];
  const outline = blocks(
    '拜访对象和目的：海川 · 了解材料准备情况',
    '已知情况',
    '客户正在准备审计报告（来源：记录资料）',
    '要问的问题',
    '审计报告需要覆盖哪些项目？',
    '要带的材料',
  );
  const output = { kind: 'visit' as const, blocks: outline };
  const fact = '情况：客户正在准备审计报告';
  const question = '问题：审计报告需要覆盖哪些项目？';
  const grounded = (...raw: string[]) =>
    writingChecks({ blocks: blocks(...raw) }, output, options, facts)
      .visitGrounded;
  assert.equal(grounded(fact, question), true);
  assert.equal(grounded(question), false);
  assert.equal(grounded(fact, '问题：本次有哪些事项需要优先确认？'), false);
  assert.equal(grounded(fact, question, '材料：审计报告'), false);
});
