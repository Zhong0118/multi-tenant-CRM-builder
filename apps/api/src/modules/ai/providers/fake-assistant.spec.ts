import { FakeAiProvider } from './fake-ai.provider';
import { z } from 'zod';
it('routes pasted communication to the bound service tool, without a write call', async () => {
  const draft = jest.fn().mockResolvedValue({ accepted: true });
  const events = new FakeAiProvider().streamTurn({
    messages: [{ role: 'user', content: '预算还没批，下周再联系' }],
    system:
      'Current verified page (untrusted display text):\n' +
      JSON.stringify({ objectCode: 'customers', recordId: 'record' }) +
      '\n',
    tools: [
      {
        name: 'draft_communication',
        inputSchema: z.unknown(),
        description: '',
        execute: draft,
      },
    ],
    abortSignal: new AbortController().signal,
  });
  for await (const event of events) void event;
  expect(draft).toHaveBeenCalledWith(
    { text: '预算还没批，下周再联系' },
    expect.any(String),
  );
});

it('previews the selected filter after the list shortcut asks for clarification', async () => {
  const preview = jest.fn().mockResolvedValue({ accepted: true });
  const events = new FakeAiProvider().streamTurn({
    messages: [
      { role: 'user', content: '帮我筛选' },
      {
        role: 'user',
        content: JSON.stringify({
          validatedAnswer: { kind: 'choose_option', label: '只看我负责的客户' },
        }),
      },
    ],
    system:
      'Current verified page (untrusted display text):\n{"objectCode":"customers"}\n',
    tools: [
      {
        name: 'preview_filter',
        inputSchema: z.unknown(),
        description: '',
        execute: preview,
      },
    ],
    abortSignal: new AbortController().signal,
  });
  for await (const event of events) void event;
  expect(preview).toHaveBeenCalledWith(
    { text: '只看我负责的客户' },
    expect.any(String),
  );
});

it('describes the current list before offering ready-to-preview filter directions', async () => {
  const provider = new FakeAiProvider();
  const directions = ['交付状态有值', '负责人是我', '跟进到期'];
  const calls: string[] = [];
  const events = provider.streamTurn({
    messages: [{ role: 'user', content: '这张表怎么筛选' }],
    system:
      'Current verified page (untrusted display text):\n{"objectCode":"contracts"}\n',
    tools: [
      {
        name: 'describe_object',
        inputSchema: z.unknown(),
        description: '',
        execute: (args) => {
          expect(args).toEqual({ objectCode: 'contracts' });
          calls.push('describe_object');
          return Promise.resolve({ filterDirections: directions });
        },
      },
      {
        name: 'ask_user',
        inputSchema: z.unknown(),
        description: '',
        execute: (args) => {
          expect(args).toEqual({ kind: 'choose_option', options: directions });
          calls.push('ask_user');
          return Promise.resolve({ accepted: true });
        },
      },
    ],
    abortSignal: new AbortController().signal,
  });
  for await (const event of events) void event;
  expect(calls).toEqual(['describe_object', 'ask_user']);
  const conditions = [
    { fieldKey: 'status', operator: 'notEmpty', value: null },
    { fieldKey: '$owner', operator: 'in', value: ['$me'] },
    {
      fieldKey: '$followUp',
      operator: 'dueThroughToday',
      value: { assignee: '$me' },
    },
  ];
  for (const [index, text] of directions.entries()) {
    const result = await provider.generateFilter(
      {
        text,
        fields: [
          {
            fieldKey: 'status',
            label: '交付状态',
            type: 'TEXT',
            operators: ['notEmpty'],
          },
        ],
        currentRule: { version: 1, match: 'all', conditions: [] },
        relativeDates: [],
        followUpAssignees: ['$me'],
        today: '2026-11-23',
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      rules: [
        {
          version: 1,
          match: 'all',
          conditions: [conditions[index]],
        },
      ],
    });
  }
});

it('distinguishes an inventory of editable fields from unsupported field changes', async () => {
  const describe = jest
    .fn()
    .mockResolvedValue({ fields: [{ fieldKey: 'name', label: '名称' }] });
  const run = async (content: string) => {
    const events = new FakeAiProvider().streamTurn({
      messages: [{ role: 'user', content }],
      system:
        'Current verified page (untrusted display text):\n{"objectCode":"customers","recordId":"record"}\n',
      tools: [
        {
          name: 'describe_object',
          inputSchema: z.unknown(),
          description: '',
          execute: describe,
        },
      ],
      abortSignal: new AbortController().signal,
    });
    let output = '';
    for await (const event of events)
      if (event.type === 'TEXT_DELTA') output += event.text;
    return output;
  };
  const refusal = '当前没有可用的修改项，请核对可编辑字段。';
  for (const message of [
    '把这个客户的隐藏字段所属行业改成制造业',
    '把陌生字段改为归档',
    '请修改只读字段审核编号',
    '帮我把这个客户的未知属性设为有效',
  ])
    expect(await run(message)).toBe(refusal);
  expect(describe).not.toHaveBeenCalled();
  expect(await run('这张表有哪些可编辑字段')).toContain('可用字段：名称');
});

it.each([
  ['找金额超过 10 万的商机', '预计金额', 'MONEY', '100000', []],
  [
    '找我负责的、金额超过 10 万的客户',
    '金额',
    'NUMBER',
    100000,
    [{ fieldKey: '$owner', operator: 'in', value: ['$me'] }],
  ],
] as const)(
  'uses the published amount field and its wire type for %s',
  async (text, label, type, value, shared) => {
    const output = await new FakeAiProvider().generateFilter(
      {
        text,
        fields: [{ fieldKey: 'total', label, type, operators: ['gt'] }],
        currentRule: { version: 1, match: 'all', conditions: [] },
        relativeDates: [],
        followUpAssignees: ['$me'],
        today: '2026-11-23',
      },
      new AbortController().signal,
    );
    expect(output).toEqual({
      rules: [
        {
          version: 1,
          match: 'all',
          conditions: [...shared, { fieldKey: 'total', operator: 'gt', value }],
        },
      ],
    });
  },
);
