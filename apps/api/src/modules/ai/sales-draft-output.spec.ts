import {
  writingSchema,
  validateReport,
  validateWriting,
  reportRange,
  writingFields,
} from './sales-draft-output';

const options = {
  kind: 'message',
  purpose: 'quote',
  tone: 'friendly',
  length: 'short',
} as const;
const block = (text: string, ...factRefs: string[]) => ({ text, factRefs });
const writing = (...blocks: ReturnType<typeof block>[]) => ({
  kind: 'message',
  subject: null,
  blocks,
});
const empty = { plans: [], completed: [], problems: [], nextSteps: [] };

it('requires subject in the provider wire schema, using null for non-email writing', () => {
  expect(writingSchema.toJSONSchema().required).toContain('subject');
  expect(
    writingSchema.safeParse({ kind: 'message', subject: null, blocks: [] })
      .success,
  ).toBe(true);
});
it('uses only visible, published scalar data and safe option labels, even for relations', () => {
  const target = {
    title: '记录 3',
    access: {
      name: 'HIDDEN',
      price: 'READ',
      stage: 'READ',
      apiKey: 'READ',
      file: 'READ',
    },
    resolved: {
      schema: {
        fields: [
          { fieldKey: 'name', label: '客户', type: 'TEXT' },
          { fieldKey: 'price', label: '报价', type: 'MONEY', validation: {} },
          {
            fieldKey: 'stage',
            label: '阶段',
            type: 'SINGLE_SELECT',
            config: {
              options: [{ key: 'q', label: '报价中', status: 'ACTIVE' }],
            },
          },
          { fieldKey: 'file', label: '文件', type: 'FILE' },
          { fieldKey: 'apiKey', label: '错误字段', type: 'TEXT' },
        ],
      },
    },
    record: {
      values: {
        name: 'SECRET',
        price: '30000',
        stage: 'q',
        file: 'SECRET',
        apiKey: 'SECRET',
        stale: 'SECRET',
      },
    },
  };
  const text = writingFields(target as never, 3).join(' ');
  expect(text).toContain('报价：30000');
  expect(text).toContain('报价中');
  expect(text).not.toContain('SECRET');
});
it('replaces unsupported amounts and delivery dates before returning any block; ref IDs and preferences are never evidence', () => {
  const facts = [{ id: 'F2', text: '报价：30000元' }];
  const draft = validateWriting(
    writing(
      block('报价三万元。', 'F2'),
      block('报价2万元。', 'F2'),
      block('保证明天交付。', 'F2'),
      block('秘密哨兵', 'unknown'),
    ),
    options,
    facts,
  );
  const body = draft.blocks.map((b) => b.text).join('');
  expect(body).toContain('三万元');
  expect(body).toContain('【报价金额】');
  expect(body).toContain('【交付日期】');
  expect(body).not.toMatch(/2万|保证明天|秘密哨兵/);
});
it('preserves conversational questions without fabricating a deal or repurposing an unrelated count', () => {
  const facts = [
    { id: 'F1', text: '远山科技' },
    { id: 'F2', text: '总共沟通2次，不能保证明天交付。' },
  ];
  const result = validateWriting(
    writing(
      block('如果您这周有空，我们约个时间聊聊您的使用体验，您看怎么样？', 'F1'),
      block('我们已经签订合同。', 'F1'),
      block('报价2元。', 'F2'),
      block('保证明天交付。', 'F2'),
    ),
    options,
    facts,
  );
  const text = result.blocks.map((b) => b.text).join('');
  expect(text).toContain('使用体验');
  expect(text).not.toMatch(/已经签订|报价2元|保证明天交付/);
  expect(text).toContain('【报价金额】');
});
it('normalizes Chinese and ISO dates but does not borrow a date as a monetary amount', () => {
  const facts = [{ id: 'F1', text: '交付日期：2026-12-05' }];
  const result = validateWriting(
    writing(block('交付日期为十二月五日。', 'F1'), block('报价2026元。', 'F1')),
    options,
    facts,
  );
  const text = result.blocks.map((b) => b.text).join('');
  expect(text).toContain('十二月五日');
  expect(text).toContain('【报价金额】');
});
it('drops uncited report claims, wrong-section citations, invented work, and duplicate coverage', () => {
  const facts = [
    { id: 'F1', section: 'completed' as const, text: '已完成回访。' },
    { id: 'F2', section: 'nextSteps' as const, text: '明日联系远山。' },
  ];
  expect(
    validateReport(
      {
        ...empty,
        plans: [block('已完成回访。', 'F1')],
        problems: [block('存在风险。', 'F1')],
        completed: [
          block('已签订合同。', 'F1'),
          block('已完成回访。', 'F1'),
          block('已完成回访。', 'F1'),
        ],
        nextSteps: [block('明日联系远山。', 'F2')],
      },
      facts,
    ),
  ).toEqual({
    plans: '',
    completed: '已完成回访。',
    problems: '',
    nextSteps: '明日联系远山。',
  });
});
it('derives next-day instants in company time and rejects invalid dates and dates outside the eight-day window', () => {
  const now = new Date('2026-11-03T06:00:00Z');
  const range = reportRange('2026-11-01', 'America/New_York', now);
  expect(range.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  expect(range.next.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  for (const day of ['2026-11-04', '2026-10-26', '2026-02-30'])
    expect(() => reportRange(day, 'America/New_York', now)).toThrow();
});
it('checks quoted prices even when the currency suffix is omitted in casual writing', () => {
  const draft = validateWriting(
    writing(block('报价三十万。', 'F1'), block('报价为三万。', 'F1')),
    options,
    [{ id: 'F1', text: '报价：30000.00' }],
  );
  expect(draft.blocks.map((b) => b.text).join('')).toContain('报价为三万');
  expect(draft.blocks.map((b) => b.text).join('')).not.toContain('三十万');
});

it('keeps ungrounded weekday and month-end delivery dates out of the message', () => {
  const draft = validateWriting(
    writing(
      block('本周三发货。', 'F1'),
      block('月底交付。', 'F1'),
      block('周五发货。', 'F1'),
    ),
    options,
    [{ id: 'F1', text: '物流安排：周五发货' }],
  );
  const text = draft.blocks.map((b) => b.text).join('');
  expect(text).not.toMatch(/本周三|月底/);
  expect(text).toContain('【交付日期】');
  expect(text).toContain('周五发货');
});

it('renders an internal visit outline, attaches sources to facts and keeps unsupported materials empty', () => {
  const facts = [
    { id: 'F1', text: '名称：海川测绘' },
    { id: 'F2', text: '合同只剩财务签字', source: '沟通记录' },
  ];
  const visit = { ...options, kind: 'visit', purpose: 'payment' } as const;
  const draft = validateWriting(
    {
      kind: 'visit',
      subject: null,
      blocks: [
        block('目的：了解合同签字进度', 'F2'),
        block('情况：合同只剩财务签字', 'F2'),
        block('问题：签字流程还有哪些待办？', 'F2'),
        block('问题：烦请确认哪一天方便安排？'),
        block('材料：合同副本', 'F2'),
      ],
    },
    visit,
    facts,
  );
  const body = draft.blocks.map((b) => b.text).join('\n');
  expect(body).toContain('海川测绘');
  expect(body).toContain('了解合同签字进度');
  expect(draft.blocks.find((b) => b.text.includes('合同只剩财务签字'))).toEqual(
    { text: '合同只剩财务签字（来源：沟通记录）', factRefs: ['F2'] },
  );
  expect(body).toContain('签字流程还有哪些待办');
  expect(body.trimEnd()).toMatch(/要带的材料\n暂无，按需补充$/);
  expect(body).not.toMatch(/烦请|概况：名称|合同副本/);
});
it('keeps explicitly requested materials with their cited source and skips customer-directed requests in the fallback', () => {
  const facts = [
    { id: 'F1', text: '森湖' },
    { id: 'F2', text: '拜访时带上产品样册' },
  ];
  const visit = { ...options, kind: 'visit' } as const;
  const draft = validateWriting(
    {
      kind: 'visit',
      subject: null,
      blocks: [block('问题：请予确认。'), block('材料：产品样册', 'F2')],
    },
    visit,
    facts,
  );
  expect(draft.blocks.at(-1)).toEqual(block('产品样册', 'F2'));
  expect(draft.blocks.map((b) => b.text).join('')).not.toMatch(
    /请予确认|贵司|您/,
  );
});
it('removes an invented owner of a neutral fact but keeps an explicitly supported role', () => {
  const facts = [
    { id: 'F1', text: '财务还在核对交接清单' },
    { id: 'F2', text: '对方采购需要样品' },
  ];
  const draft = validateWriting(
    writing(
      block('我方财务还在核对交接清单。', 'F1'),
      block('财务还在核对交接清单。', 'F1'),
      block('贵司采购需要样品。', 'F2'),
    ),
    { ...options, purpose: 'followup' },
    facts,
  );
  expect(draft.blocks.map((b) => b.text)).toEqual([
    '财务还在核对交接清单。',
    '贵司采购需要样品。',
  ]);
});

describe('visit materials and point of view', () => {
  const visit = { ...options, kind: 'visit', purpose: 'followup' } as const;
  const outline = (fact: string, ...extra: ReturnType<typeof block>[]) =>
    validateWriting(
      {
        kind: 'visit',
        subject: null,
        blocks: [
          block('情况：' + fact, 'F2'),
          block('问题：审计报告需要覆盖哪些项目？', 'F2'),
          ...extra,
        ],
      },
      visit,
      [
        { id: 'F1', text: '海川' },
        { id: 'F2', text: fact },
      ],
    );
  it.each([
    ['客户正在准备审计报告', false],
    ['客户将在拜访时携带审计报告', false],
    ['供应商负责准备审计报告', false],
    ['客户询问销售能否带审计报告', false],
    ['销售已要求客户准备审计报告', false],
    ['客户请销售在拜访时携带审计报告', true],
    ['拜访时带上审计报告', true],
  ])('uses the responsible party and instruction in %s', (fact, supported) => {
    const draft = outline(fact, block('材料：审计报告', 'F2'));
    expect(draft.blocks.some((b) => b.text === '审计报告')).toBe(supported);
  });
  it('rejects a first person visit question', () => {
    const d = outline(
      '审计报告正在核对',
      block('问题：我想了解审计报告进度，可以吗？', 'F2'),
    );
    expect(d.blocks.map((b) => b.text).join('')).not.toContain('我想');
  });
  it.each([
    '财务同事正在替我司核对交接清单。',
    '财务正在帮贵公司核对交接清单。',
    '财务正代表供应商核对交接清单。',
  ])('rejects an unsupported beneficiary in %s', (text) => {
    const d = validateWriting(
      writing(block(text, 'F2')),
      { ...options, purpose: 'followup' },
      [{ id: 'F2', text: '财务正在核对交接清单' }],
    );
    expect(d.blocks.map((b) => b.text)).not.toContain(text);
  });
});
it('retains an explicit beneficiary without transferring a third-party or negated assignment', () => {
  const source = '财务同事正在替供应商核对交接清单。';
  const reversed = '财务同事正在替我司核对交接清单。';
  const draft = validateWriting(
    writing(block(source, 'F2'), block(reversed, 'F2'), block(reversed, 'F3')),
    { ...options, purpose: 'followup' },
    [
      { id: 'F2', text: source },
      { id: 'F3', text: '财务同事没有替我司核对交接清单。' },
    ],
  );
  expect(draft.blocks).toEqual([block(source, 'F2')]);
});
it('anchors the delivered fallback for a fact-bearing visit in an actual source and a concrete task', () => {
  const draft = validateWriting(
    { kind: 'visit', subject: null, blocks: [] },
    { ...options, kind: 'visit' },
    [
      { id: 'F1', text: '清池' },
      { id: 'F2', text: '物流交接清单仍在核对', source: '沟通记录' },
    ],
  );
  expect(draft.blocks).toContainEqual(
    block('物流交接清单仍在核对（来源：沟通记录）', 'F2'),
  );
  expect(draft.blocks).toContainEqual(
    block('记录提到「物流交接清单仍在核对」，下一步由谁负责跟进？', 'F2'),
  );
});

describe('writing from this request’s supplement', () => {
  const supplement = '确认一下交期，顺便问样品收到没有';
  const facts = [
    { id: 'F1', text: '远山科技', source: '记录名称' },
    { id: 'F2', text: supplement, source: '本次补充' },
    {
      id: 'F3',
      text: '跟进：确认远山科技交期；到期 2026-11-22',
      source: '待办跟进',
    },
  ];
  it('keeps a sourced receipt question, restores a missing explicit request and aligns the email subject with the delivered body', () => {
    const email = {
      ...options,
      purpose: 'followup',
      kind: 'email',
      supplement,
    } as const;
    for (const blocks of [
      [block('交期方便确定吗？', 'F2')],
      [block('交期方便确定吗？', 'F2'), block('样品是否已经收到？', 'F2')],
    ]) {
      const d = validateWriting(
        { kind: 'email', subject: '确认交期与样品接收情况', blocks },
        email,
        facts,
      );
      expect(
        d.blocks.some(
          (b) => b.text.includes('样品') && b.factRefs.includes('F2'),
        ),
      ).toBe(true);
      expect(d.subject).toContain('样品');
    }
    const d = validateWriting(
      {
        kind: 'email',
        subject: '交期与合同续约',
        blocks: [block('目前的交期如何安排？', 'F2')],
      },
      email,
      facts,
    );
    expect(d.subject).not.toMatch(/续约/);
  });
  it('uses both requested matters for the visit purpose and questions, and keeps internal follow-ups out of questions', () => {
    const visit = {
      ...options,
      purpose: 'followup',
      kind: 'visit',
      supplement,
    } as const;
    const d = validateWriting(
      {
        kind: 'visit',
        subject: null,
        blocks: [
          block('目的：了解当前进展和后续安排'),
          block('问题：下一步由谁负责跟进交期？', 'F3'),
        ],
      },
      visit,
      facts,
    );
    expect(d.blocks[0].text).toMatch(/交期.*样品/);
    const questions = d.blocks.slice(
      d.blocks.findIndex((b) => b.text === '要问的问题') + 1,
      d.blocks.findIndex((b) => b.text === '要带的材料'),
    );
    expect(questions.map((b) => b.text).join('')).toMatch(/交期.*样品/);
    expect(questions.map((b) => b.text).join('')).not.toMatch(/负责跟进|到期/);
    expect(d.blocks.map((b) => b.text).join('')).toContain('来源：本次补充');
    expect(d.blocks.at(-1)?.text).toBe('暂无，按需补充');
  });
  it('keeps placeholders out of a visit purpose and never repackages an internal task as a question', () => {
    const d = validateWriting(
      {
        kind: 'visit',
        subject: null,
        blocks: [
          block('目的：了解【报价金额】'),
          block('问题：跟进该由谁负责？', 'F3'),
        ],
      },
      { ...options, kind: 'visit' },
      [facts[0], facts[2]],
    );
    expect(d.blocks[0].text).not.toContain('【');
    const questions = d.blocks.slice(
      d.blocks.findIndex((b) => b.text === '要问的问题') + 1,
      d.blocks.findIndex((b) => b.text === '要带的材料'),
    );
    expect(questions.map((b) => b.text).join('')).not.toMatch(/跟进|到期|负责/);
  });
});
