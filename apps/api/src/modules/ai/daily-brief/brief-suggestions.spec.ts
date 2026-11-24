import { validateSuggestions } from './brief-suggestions';

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
      { ref: 'R1F1', text: '过期待回签：合同副本尚未取回' },
      { ref: 'R1F2', text: '报价：30000元，共2份，交付日期：2026-12-05' },
    ],
  },
];
const grounded = {
  recordRef: 'R1',
  reasonFactRefs: ['R1F1'],
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
      reasonFactRefs: ['R1F2'],
      suggestedTitle: '核对三万元报价',
      explanation: '核对2份报价单，确认十二月五日交付安排。',
    }),
  ).toMatchObject({ usedFallback: false });
  // A model may independently choose the same wording as the template.
  expect(
    check({ suggestedTitle: '致电确认近况', explanation: '建议致电确认近况' }),
  ).toMatchObject({ usedFallback: false });
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
