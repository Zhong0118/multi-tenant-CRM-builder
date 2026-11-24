import {
  briefPromptRecords,
  displayBriefWording,
  displayBriefReason,
  validateSuggestions,
} from './brief-suggestions';

it('only trusts a candidate’s own facts and renders them as the reason', () => {
  const candidates = [
    {
      recordRef: 'R1',
      recordId: 'one',
      fingerprint: 'hash',
      title: '一号',
      objectName: '客户',
      facts: [{ ref: 'R1F1', text: '跟进已逾期' }],
    },
  ];
  const item = {
    recordRef: 'R1',
    reasonFactRefs: ['R1F1'],
    action: 'call',
    explanation: '虚构已付款',
  };
  const output = validateSuggestions(
    {
      items: [
        { ...item, recordRef: 'R2' },
        { ...item, reasonFactRefs: ['R2F1'] },
        { ...item, suggestedDue: '2026-02-30' },
        item,
        item,
      ],
    },
    candidates,
    '2026-01-01',
  );
  expect(output).toHaveLength(1);
  expect(output[0]).toMatchObject({
    recordId: 'one',
    reason: '跟进已逾期',
    action: 'call',
  });
  expect(JSON.stringify(output)).not.toContain('已付款');
});

const candidates = [
  {
    recordRef: 'R1',
    recordId: 'one',
    fingerprint: 'visibleHash',
    title: '示例客户',
    objectName: '客户',
    facts: [
      { ref: 'R1F2', text: '过期待回签：合同副本尚未取回' },
      { ref: 'R1F3', text: '报价：30000元，共2份，交付日期：2026-12-05' },
    ],
  },
];
const grounded = {
  recordRef: 'R1',
  reasonFactRefs: ['R1F2'],
  action: 'call',
  explanation: '联系经办人确认合同副本的回签进度。',
  suggestedTitle: '确认合同副本回签',
};
const check = (changes: Record<string, unknown> = {}) =>
  validateSuggestions(
    { items: [{ ...grounded, ...changes }] },
    candidates,
    '2026-11-24',
  )[0];

it('preserves specific model wording and uses only cited facts in the reason', () => {
  expect(check()).toMatchObject({
    suggestedTitle: grounded.suggestedTitle,
    explanation: grounded.explanation,
    reason: candidates[0].facts[0].text,
    usedFallback: false,
  });
  expect(
    check({
      reasonFactRefs: ['R1F3'],
      suggestedTitle: '核对三万元报价',
      explanation: '核对2份报价单，确认十二月五日交付安排。',
    }),
  ).toMatchObject({ usedFallback: false });
  // Generic template wording has no verifiable link to the cited subject.
  expect(
    check({ suggestedTitle: '致电确认近况', explanation: '建议致电确认近况' }),
  ).toMatchObject({ usedFallback: true });
});

it('preserves the proposed future action date when wording falls back', () => {
  const suggestedDue = '2026-12-05';
  expect(check({ suggestedDue, explanation: '保证付款。' })).toMatchObject({
    suggestedDue,
    usedFallback: true,
  });
});

it.each([
  { suggestedTitle: null },
  { suggestedTitle: ' ' },
  { suggestedTitle: '长'.repeat(21) },
  { explanation: '长'.repeat(41) },
  { explanation: '联系经办人。\n再联系一次。' },
  { explanation: '确认进度。保证回款。' },
  { suggestedTitle: '核对免费的报价' },
  { explanation: '确认三万元报价。' },
  { suggestedTitle: '核对2份合同' },
  { explanation: '核对一台设备。' },
  { explanation: '核对二十张合同。' },
  { suggestedTitle: '确认十二月五日回签' },
  { explanation: '明日致电确认合同副本进度。' },
  { explanation: '确认已付款。' },
])(
  'falls back the entire item when either field fails, without persisting rejected wording: %p',
  (changes) => {
    expect(check(changes)).toMatchObject({
      suggestedTitle: '致电确认近况',
      explanation: '建议致电确认近况',
      usedFallback: true,
    });
  },
);

it('requires each field to match a cited subject and rejects even mixed-in subjects from uncited facts', () => {
  const rows = [
    {
      ...candidates[0],
      facts: [
        { ref: 'R1F2', text: '联系经办人确认，需补发产品目录' },
        { ref: 'R1F3', text: '展台灯具待验收' },
      ],
    },
    {
      ...candidates[0],
      recordRef: 'R2',
      recordId: 'two',
      facts: [
        { ref: 'R2F2', text: '联系经办人安排股权收购' },
        { ref: 'R2F3', text: '请核对产品目录' },
      ],
    },
  ];
  const run = (suggestedTitle: string, explanation: string) =>
    validateSuggestions(
      { items: [{ ...grounded, suggestedTitle, explanation }] },
      rows,
      '2026-11-24',
    )[0].usedFallback;
  expect(run('确认股权收购', '联系经办人安排股权收购。')).toBe(true);
  expect(run('确认产品目录', '联系经办人安排产品目录及股权收购。')).toBe(true);
  expect(run('核对展台灯具和产品目录', '确认产品目录。')).toBe(true);
  expect(run('联系经办人确认', '请联系经办人确认产品目录。')).toBe(true);
  expect(run('补发产品目录', '联系经办人确认新的温度计。')).toBe(true);
  expect(run('补发产品目录', '请联系经办人核对产品目录。')).toBe(false);
});

it('uses CRM priority only for the reason and keeps the task tied to cited business evidence', () => {
  const run = (
    suggestedTitle: string,
    explanation: string,
    refs = ['R1F1', 'R1F2'],
    business = '报价含税但未确认运费',
  ) => {
    const rows = [
      {
        ...candidates[0],
        facts: [
          { ref: 'R1F1', text: '两天后到期收回' },
          { ref: 'R1F2', text: business },
        ],
      },
    ];
    return validateSuggestions(
      {
        items: [
          { ...grounded, suggestedTitle, explanation, reasonFactRefs: refs },
        ],
      },
      rows,
      '2026-11-24',
    )[0];
  };
  expect(run('确认到期收回', '联系对方确认到期收回。').usedFallback).toBe(true);
  expect(
    run('确认报价运费', '确认运费，同时联系对方回收设备。').usedFallback,
  ).toBe(true);
  expect(run('确认报价回款', '联系对方确认运费及回款日期。').usedFallback).toBe(
    true,
  );
  expect(run('确认运费', '联系对方确认运费。', ['R1F1']).usedFallback).toBe(
    true,
  );
  expect(run('核对运费', '联系经办人核对报价中的运费。')).toMatchObject({
    reason: '两天后到期收回；报价含税但未确认运费',
    usedFallback: false,
  });
  expect(
    run(
      '回收测试样机',
      '联系经办人确认如何回收测试样机。',
      ['R1F2'],
      '业务约定：回收测试样机',
    ).usedFallback,
  ).toBe(false);
});

it('can suggest an open question when the only visible business field is a name', () => {
  const rows = [
    {
      ...candidates[0],
      title: '青城科技',
      facts: [
        { ref: 'R1F1', text: '即将或已经到达回收期限 2026-11-26' },
        { ref: 'R1F2', text: '客户名称：青城科技' },
      ],
    },
  ];
  const item = {
    ...grounded,
    reasonFactRefs: ['R1F1', 'R1F2'],
    suggestedTitle: '联系「青城科技」了解需求',
    explanation: '询问「青城科技」近期有无需要协助的事项。',
  };
  expect(
    validateSuggestions({ items: [item] }, rows, '2026-11-24')[0],
  ).toMatchObject({
    usedFallback: false,
    suggestedTitle: item.suggestedTitle,
    explanation: item.explanation,
  });
});

it('sends priority references in sorted order and only authorized business facts as writing material', () => {
  const rows = [
    {
      ...candidates[0],
      facts: [
        { ref: 'R1F1', text: 'CRM内部回收到期日 2026-12-02' },
        { ref: 'R1F2', text: '待跟进：确认远山科技交期' },
        { ref: 'R1F3', text: '阶段：正在准备演示' },
      ],
    },
    {
      ...candidates[0],
      recordRef: 'R2',
      facts: [{ ref: 'R2F1', text: '阶段停留15天' }],
    },
  ];
  expect(briefPromptRecords(rows)).toEqual([
    { recordRef: 'R1', priorityRef: 'R1F1', facts: rows[0].facts.slice(1) },
    { recordRef: 'R2', priorityRef: 'R2F1', facts: [] },
  ]);
});

it('recognizes a cited organization after a contact verb and treats assistance as conversational wording', () => {
  const rows = [
    {
      ...candidates[0],
      facts: [{ ref: 'R1F2', text: '待跟进：确认远山科技交期' }],
    },
    {
      ...candidates[0],
      recordRef: 'R2',
      recordId: 'two',
      facts: [{ ref: 'R2F2', text: '待跟进：协助采购轴承' }],
    },
  ];
  const run = (suggestedTitle: string, explanation: string) =>
    validateSuggestions(
      { items: [{ ...grounded, suggestedTitle, explanation }] },
      rows,
      '2026-11-24',
    )[0];
  expect(
    run('核对远山科技交期', '联系远山科技确认交期，询问是否需要协助。')
      .usedFallback,
  ).toBe(false);
  expect(run('核对南方远山科技交期', '确认远山科技交期。').usedFallback).toBe(
    true,
  );
  expect(
    run('核对远山科技交期', '联系远山科技协助采购轴承。').usedFallback,
  ).toBe(true);
});

it('removes a repeated contact prefix and hides only a redundant explanation', () => {
  expect(
    displayBriefWording({
      suggestedTitle: '联系联系人确认收件地址',
      explanation: '请确认收件地址。',
    }),
  ).toEqual({ suggestedTitle: '确认收件地址', explanation: '' });
  expect(
    displayBriefWording({
      suggestedTitle: '确认交期',
      explanation: '电话确认交期，顺便问样品是否收到。',
    }).explanation,
  ).toContain('电话');
});

it('summarizes a multiline communication only for the visible reason', () => {
  const text =
    '沟通：您好！\n沟通：已核对收件地址。\n报价金额为【报价金额】，请确认。\n结果：样品尚未收到。\n谢谢！';
  const rows = [{ ...candidates[0], facts: [{ ref: 'R1F2', text }] }];
  expect(briefPromptRecords(rows)[0].facts[0].text).toBe(text);
  expect(
    validateSuggestions({ items: [grounded] }, rows, '2026-11-24')[0].reason,
  ).toBe('示例客户：记录沟通，已核对收件地址；样品尚未收到。');
});

it('omits the repeated title field and separates cited facts cleanly', () => {
  expect(
    displayBriefReason(
      '远山科技',
      ['沟通：已确认交期。', '企业字号：远山科技', '商机阶段：方案报价'],
      '企业字号',
    ),
  ).toBe('远山科技：记录沟通，已确认交期；商机阶段：方案报价');
  expect(
    displayBriefReason('远山科技', ['企业字号：远山科技'], '企业字号'),
  ).toBe('');
  expect(displayBriefReason('远山科技', ['合作方：远山科技'], '企业字号')).toBe(
    '合作方：远山科技',
  );
});
