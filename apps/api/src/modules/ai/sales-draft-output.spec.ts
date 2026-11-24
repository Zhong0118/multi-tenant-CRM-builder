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
  expect(body.trimEnd()).toMatch(/要带的材料[：:]?$/);
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
