import { FakeAiProvider } from './providers/fake-ai.provider';
import { generateTablePlan, validateAnswers } from './table-generation';

const provider = new FakeAiProvider();
const signal = new AbortController().signal;
const create = (description: string) =>
  generateTablePlan(
    provider,
    { mode: 'create', description, existing: [] },
    signal,
  );

it('drafts four rental tables and retains identity for fields kept by a refinement', async () => {
  const draft = await create(
    '我们做设备租赁，管理客户、合同、设备和回款，销售只能看自己的',
  );
  if (draft.kind !== 'blueprint') throw Error('expected blueprint');
  expect(draft.blueprint.tables).toHaveLength(4);
  const contract = draft.blueprint.tables.find((t) => t.name.includes('合同'))!;
  const next = await generateTablePlan(
    provider,
    {
      mode: 'refine',
      description: '加签约日期，去掉备注',
      existing: [],
      table: contract,
    },
    signal,
  );
  if (next.kind !== 'blueprint') throw Error('expected blueprint');
  const updated = next.blueprint.tables[0];
  expect(updated.id).toBe(contract.id);
  expect(updated.titleFieldId).toBe(contract.titleFieldId);
  expect(updated.fields).toContainEqual(
    expect.objectContaining({ label: '签约日期', type: 'DATE' }),
  );
  expect(updated.fields.some((f) => f.label === '备注')).toBe(false);
});

it('validates fixed ordered choices and finishes after at most two questions', async () => {
  const description = '帮我建表';
  expect(await create(description)).toMatchObject({
    kind: 'question',
    key: 'industry',
  });
  const answers = [{ key: 'industry' as const, choiceId: 'rental' }];
  expect(
    await generateTablePlan(
      provider,
      { mode: 'create', description, existing: [], answers },
      signal,
    ),
  ).toMatchObject({ kind: 'question', key: 'entities' });
  const final = await generateTablePlan(
    provider,
    {
      mode: 'create',
      description,
      existing: [],
      answers: [...answers, { key: 'entities', choiceId: 'customers' }],
    },
    signal,
  );
  if (final.kind !== 'blueprint') throw Error('expected blueprint');
  expect(final.blueprint.assumptions.length).toBeGreaterThan(0);
  expect(() =>
    validateAnswers([{ key: 'entities', choiceId: 'customers' }]),
  ).toThrow();
  expect(() =>
    validateAnswers([{ key: 'industry', choiceId: 'forged' }]),
  ).toThrow();
  expect(() =>
    validateAnswers([{ key: 'industry', choiceId: 'other', otherText: ' ' }]),
  ).toThrow();
});

it('does not call the provider once cancelled', async () => {
  const spy = jest.spyOn(provider, 'generateTableBlueprint');
  try {
    await expect(
      generateTablePlan(
        provider,
        { mode: 'create', description: '设备租赁', existing: [] },
        AbortSignal.abort(),
      ),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('keeps existing names for collision review and appends proposed fields only', async () => {
  const existing = [
    {
      id: 'tenant-object-id',
      name: '客户',
      code: 'private-key',
      version: 2,
      fields: [{ fieldKey: 'hidden_key', label: '来源', type: 'TEXT' }],
    },
  ];
  const spy = jest.spyOn(provider, 'generateTableBlueprint');
  try {
    const withSameName = await generateTablePlan(
      provider,
      { mode: 'create', description: '只建客户表', existing },
      signal,
    );
    expect(withSameName).toMatchObject({
      kind: 'blueprint',
      blueprint: { tables: [{ name: '客户' }] },
    });
    const result = await generateTablePlan(
      provider,
      {
        mode: 'append',
        description: '补充来源、行业、规模',
        existing,
        target: { objectId: existing[0].id, expectedVersion: 2 },
      },
      signal,
    );
    if (result.kind !== 'blueprint') throw Error('expected blueprint');
    expect(result.blueprint.tables[0]).toMatchObject({
      id: existing[0].id,
      name: '客户',
      code: existing[0].code,
      titleFieldId: '',
      view: { columnIds: [] },
      employeeIntent: [],
    });
    expect(result.blueprint.tables[0].fields.map((f) => f.label)).toEqual([
      '来源',
      '行业',
      '规模',
    ]);
    const prompt = JSON.stringify(spy.mock.calls.at(-1)![0]);
    expect(prompt).not.toMatch(/tenant-object-id|private-key|hidden_key/);
  } finally {
    spy.mockRestore();
  }
});

it('reports unsupported fields, distinguishes domain-specific fields, and preserves legitimate dates and members', async () => {
  const raw = await provider.generateTableBlueprint(
    {
      mode: 'create',
      description: '只建合同表',
      existing: [],
      answers: [],
      mayAsk: true,
    },
    signal,
  );
  const t = raw.tables[0];
  for (const [i, [label, type]] of [
    ['负责人', 'MEMBER'],
    ['技术顾问', 'MEMBER'],
    ['毛利', 'FORMULA'],
    ['关联客户', 'RELATION'],
    ['合同附件', 'FILE'],
  ].entries()) {
    t.fields.push({
      ...t.fields[0],
      ref: 'new:extra' + i,
      label,
      type,
      required: false,
    });
    t.columnRefs.push('new:extra' + i);
  }
  const withRaw = {
    ...provider,
    streamTurn: provider.streamTurn.bind(provider),
    generateTableBlueprint: () => Promise.resolve(raw),
  };
  const result = await generateTablePlan(
    withRaw,
    { mode: 'create', description: '设计合同表', existing: [] },
    signal,
  );
  if (result.kind !== 'blueprint') throw Error('expected blueprint');
  expect(result.blueprint.tables[0].fields.map((f) => f.label)).toEqual(
    expect.arrayContaining(['合同到期日', '技术顾问']),
  );
  expect(result.blueprint.omitted.map((o) => o.request)).toEqual(
    expect.arrayContaining(['负责人', '毛利', '关联客户', '合同附件']),
  );
  expect(
    result.blueprint.tables[0].view.columnIds.every((id) =>
      result.blueprint.tables[0].fields.some((f) => f.id === id),
    ),
  ).toBe(true);
});

it('rejects unknown and duplicate existing field refs, invalid option refs, type errors and executable settings with a field path', async () => {
  const first = await create('只建合同表');
  if (first.kind !== 'blueprint') throw Error('expected blueprint');
  const chosen = first.blueprint.tables[0];
  const request = {
    mode: 'refine' as const,
    description: '保持当前方案',
    existing: [],
    table: chosen,
  };
  const mutations = [
    (t: import('./table-model').ModelTable) => {
      t.fields[0].ref = 'alien-id';
    },
    (t: import('./table-model').ModelTable) => {
      t.fields[0].ref = t.fields[1].ref;
    },
    (t: import('./table-model').ModelTable) => {
      t.fields.find((f) => f.options.length)!.options[0].ref = 'alien-option';
    },
    (t: import('./table-model').ModelTable) => {
      t.fields[0].type = 'ARBITRARY';
    },
    (t: import('./table-model').ModelTable) => {
      Object.assign(t, { employeeAccess: { canRead: true } });
    },
    (t: import('./table-model').ModelTable) => {
      t.columnRefs.push('another-table-ref');
    },
  ];
  for (const mutate of mutations) {
    const withRaw = {
      ...provider,
      streamTurn: provider.streamTurn.bind(provider),
      generateTableBlueprint: async (
        input: import('./table-model').TableProviderInput,
      ) => {
        const raw = await provider.generateTableBlueprint(input, signal);
        mutate(raw.tables[0]);
        return raw;
      },
    };
    await expect(
      generateTablePlan(withRaw, request, signal),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: expect.any(Object) as unknown,
    });
  }
});

it('rejects append mutations and out-of-budget context before returning a candidate', async () => {
  const existing = [
    { id: 'dest', name: '客户', code: 'customer', version: 3, fields: [] },
  ];
  const target = { objectId: 'dest', expectedVersion: 3 };
  const withRaw = {
    ...provider,
    streamTurn: provider.streamTurn.bind(provider),
    generateTableBlueprint: async (
      input: import('./table-model').TableProviderInput,
    ) => {
      const raw = await provider.generateTableBlueprint(input, signal);
      raw.tables[0].name = '重命名';
      return raw;
    },
  };
  await expect(
    generateTablePlan(
      withRaw,
      { mode: 'append', description: '来源', existing, target },
      signal,
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const huge = Array.from({ length: 1000 }, (_, i) => ({
    ...existing[0],
    name: 'Archived table ' + i,
  }));
  const spy = jest.spyOn(provider, 'generateTableBlueprint');
  try {
    await expect(
      generateTablePlan(
        provider,
        { mode: 'create', description: '帮我设计设备表', existing: huge },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('handles bounded English fixtures and provider failures', async () => {
  const english = await create('Create a Customers table with email and phone');
  if (english.kind !== 'blueprint') throw Error('expected blueprint');
  expect(english.blueprint.tables[0].name).toBe('Customers');
  expect(english.blueprint.tables[0].fields.map((f) => f.type)).toEqual(
    expect.arrayContaining(['EMAIL', 'PHONE']),
  );
  await expect(create('模拟服务不可用')).rejects.toMatchObject({
    code: 'AI_PROVIDER_UNAVAILABLE',
  });
});

it('preserves select and option identity on rename and reorder', async () => {
  const draft = await create('只建合同表');
  if (draft.kind !== 'blueprint') throw Error('expected blueprint');
  const chosen = draft.blueprint.tables[0];
  const state = chosen.fields.find((f) => f.options?.length)!;
  const old = state.options![0];
  const adapter = {
    ...provider,
    streamTurn: provider.streamTurn.bind(provider),
    generateTableBlueprint: async (
      input: import('./table-model').TableProviderInput,
    ) => {
      const candidate = await provider.generateTableBlueprint(input, signal);
      const t = candidate.tables[0];
      const f = t.fields.find((item) => item.ref === state.id)!;
      f.options[0].label = '待签';
      f.options.reverse();
      f.label = '履约状态';
      t.fields.reverse();
      t.name = '设备租赁合同';
      return candidate;
    },
  };
  const next = await generateTablePlan(
    adapter,
    {
      mode: 'refine',
      description: '重排列并调整名称',
      existing: [],
      table: chosen,
    },
    signal,
  );
  if (next.kind !== 'blueprint') throw Error('expected blueprint');
  const updated = next.blueprint.tables[0].fields.find(
    (f) => f.id === state.id,
  )!;
  expect(updated.label).toBe('履约状态');
  expect(updated.options?.at(-1)).toEqual({ ...old, label: '待签' });
  expect(next.blueprint.tables[0].titleFieldId).toBe(chosen.titleFieldId);
});
