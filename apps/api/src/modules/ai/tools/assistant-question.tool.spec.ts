import { createQuestionTools } from './assistant-question.tool';
describe('ask_user', () => {
  const [tool] = createQuestionTools(async (input) => input);
  const ask = (input: unknown) => tool!.execute(input, 'call');
  it('offers a choice only from short distinct plain text labels', async () => {
    for (const options of [
      ['甲'],
      ['甲', '甲'],
      ['甲', 'https://example.org'],
      ['甲', '<em>乙</em>'],
      ['甲', '**加粗**'],
      ['甲', '记录 4ae1001a-3a78-4b45-9013-1b20143688ea'],
      ['甲', '长'.repeat(41)],
      ['甲', '其他'],
    ])
      await expect(ask({ kind: 'choose_option', options })).rejects.toThrow();
    expect(
      await ask({
        kind: 'choose_option',
        options: ['只记纪要', '附上跟进建议'],
      }),
    ).toMatchObject({ kind: 'choose_option' });
  });
  it('does not accept provider-supplied option ids or field definitions', async () => {
    await expect(
      ask({
        kind: 'choose_record',
        objectCode: 'leads',
        recordIds: [],
        options: [{ id: '1', label: 'x' }],
      }),
    ).rejects.toThrow();
    await expect(
      ask({
        kind: 'fill_fields',
        objectCode: 'leads',
        recordId: '4ae1001a-3a78-4b45-9013-1b20143688ea',
        fieldKeys: [],
        fields: [{ key: 'owner' }],
      }),
    ).rejects.toThrow();
  });
});
