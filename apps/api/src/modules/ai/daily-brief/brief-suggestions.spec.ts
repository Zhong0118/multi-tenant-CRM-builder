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
