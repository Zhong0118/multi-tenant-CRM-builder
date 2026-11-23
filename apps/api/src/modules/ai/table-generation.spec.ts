import { blueprintCode, validateBlueprint } from './table-blueprint';
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
  expect(updated.code).toBe('rental-contracts');
  expect(updated.titleFieldId).toBe(contract.titleFieldId);
  expect(updated.fields).toContainEqual(
    expect.objectContaining({
      label: '签约日期',
      type: 'DATE',
      fieldKey: 'sign_date',
    }),
  );
  expect(updated.fields.some((f) => f.label === '备注')).toBe(false);
});

it('asks about a generic request and previews after receiving an industry', async () => {
  const description = '帮我建表';
  expect(await create(description)).toMatchObject({
    kind: 'question',
    key: 'industry',
  });
  const answers = [{ key: 'industry' as const, choiceId: 'rental' }];
  const industryPreview = await generateTablePlan(
    provider,
    { mode: 'create', description, existing: [], answers },
    signal,
  );
  if (industryPreview.kind !== 'blueprint')
    throw new Error('expected industry preview');
  expect(industryPreview.blueprint.tables.map((t) => t.name)).toContain('客户');
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
      fields: [
        { fieldKey: 'hidden_key', label: '来源', type: 'TEXT' },
        { fieldKey: 'size', label: '旧规模', type: 'TEXT' },
      ],
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
    const appended = result.blueprint.tables[0].fields;
    expect(appended[0].fieldKey).toBe('source');
    expect(appended[2].fieldKey).toBe(blueprintCode(appended[2].id, 'field'));
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
  chosen.code = 'agreements';
  state.fieldKey = 'lifecycle_state';
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
      f.fieldKeySuggestion = 'other';
      t.codeSuggestion = 'other';
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
  expect(updated.fieldKey).toBe('lifecycle_state');
  expect(next.blueprint.tables[0].code).toBe('agreements');
  expect(updated.options?.at(-1)).toEqual({ ...old, label: '待签' });
  expect(next.blueprint.tables[0].titleFieldId).toBe(chosen.titleFieldId);
});

it('keeps valid suggestions and flags per-row fallbacks for invalid or occupied model codes', async () => {
  const existing = [
    { id: 'old', code: 'customers', name: '旧客户', fields: [] },
  ];
  const result = await generateTablePlan(
    {
      ...provider,
      streamTurn: provider.streamTurn.bind(provider),
      generateTableBlueprint: async (input, abort) => {
        const raw = await provider.generateTableBlueprint(input, abort);
        raw.tables[2].codeSuggestion = raw.tables[1].codeSuggestion;
        raw.tables[1].fields[1].fieldKeySuggestion = 'name';
        raw.tables[1].fields[2].fieldKeySuggestion = 'bad-key';
        return raw;
      },
    },
    { mode: 'create', description: '设备租赁', existing },
    signal,
  );
  if (result.kind !== 'blueprint') throw Error('expected blueprint');
  const { blueprint, issues } = validateBlueprint(result.blueprint, existing);
  const [customers, contract, equipment] = blueprint.tables;
  expect(customers.code).toBe(blueprintCode(customers.id, 'object'));
  expect(equipment.code).toBe(blueprintCode(equipment.id, 'object'));
  expect(contract.code).toBe('rental-contracts');
  expect(contract.fields[0].fieldKey).toBe('name');
  for (const f of contract.fields.slice(1, 3)) {
    expect(f.fieldKey).toBe(blueprintCode(f.id, 'field'));
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CODE_FALLBACK',
        fieldId: f.id,
        tableId: contract.id,
        blocking: false,
      }),
    );
  }
  expect(issues.filter((i) => i.code === 'CODE_FALLBACK')).toHaveLength(4);
  expect(issues.filter((i) => i.blocking)).toEqual([]);
});

it('previews every explicit candidate even when the model flags a question, including name collisions', async () => {
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
  const names = Array.from({ length: 13 }, (_, i) => 'Entity ' + (i + 1));
  raw.tables = names.map((name, i) => ({
    ...raw.tables[0],
    name,
    codeSuggestion: 'entity-' + i,
  }));
  raw.needsDetails = true;
  const existing = [
    { name: names[0], id: 'archived', code: 'archived', fields: [] },
  ];
  const result = await generateTablePlan(
    {
      ...provider,
      streamTurn: provider.streamTurn.bind(provider),
      generateTableBlueprint: () => Promise.resolve(raw),
    },
    { mode: 'create', description: names.join(', '), existing },
    signal,
  );
  if (result.kind !== 'blueprint') throw new Error('expected blueprint');
  const checked = validateBlueprint(result.blueprint, existing);
  expect(checked.blueprint.tables.map((t) => t.name)).toEqual(names);
  expect(checked.issues).toContainEqual(
    expect.objectContaining({
      code: 'TABLE_COUNT',
      message: '一次最多创建 6 张，请移除 7 张',
      blocking: true,
    }),
  );
  expect(checked.issues).toContainEqual(
    expect.objectContaining({
      code: 'NAME_IN_USE',
      tableId: result.blueprint.tables[0].id,
      blocking: true,
    }),
  );
});

it('defers append-only fields until selected and prevents a later refinement from silently reintroducing them', async () => {
  const target = {
    objectId: 'e49ea50d-f66e-41e5-b6e8-2854cc646a52',
    expectedVersion: 2,
  };
  const existing = [
    {
      id: target.objectId,
      version: 2,
      code: 'quotes',
      name: '报价',
      fields: [{ fieldKey: 'title', label: '标题', type: 'TEXT' }],
    },
  ];
  const adapter = {
    ...provider,
    streamTurn: provider.streamTurn.bind(provider),
    generateTableBlueprint: async (
      input: import('./table-model').TableProviderInput,
    ) => {
      const raw = await provider.generateTableBlueprint(input, signal);
      const table = raw.tables[0];
      if (!table.fields.some((f) => f.label === '净价'))
        table.fields.push({
          ref: 'new:net',
          fieldKeySuggestion: 'net_total',
          label: '净价',
          type: 'MONEY',
          required: false,
          reason: '手工输入',
          options: [],
          validation: null,
        });
      if (input.mode === 'append')
        raw.omitted.push({
          request: '净价',
          reason: '不支持计算',
          alternative: null,
          tableName: '报价',
          manualField: null,
        });
      return raw;
    },
  };
  const generated = await generateTablePlan(
    adapter,
    {
      mode: 'append',
      description: '增加来源和自动计算的净价',
      target,
      existing,
    },
    signal,
  );
  if (generated.kind !== 'blueprint') throw new Error('expected blueprint');
  const { blueprint } = validateBlueprint(
    generated.blueprint,
    existing,
    target,
  );
  const selected = blueprint.tables[0];
  expect(selected.fields.map((f) => f.label)).toEqual(['来源']);
  expect(blueprint.omitted[0]).toMatchObject({
    tableId: target.objectId,
    manualField: { label: '净价', fieldKey: 'net_total' },
  });
  const input = {
    mode: 'refine' as const,
    description: '保留调整',
    target,
    existing,
    table: selected,
    omitted: blueprint.omitted,
  };
  const next = await generateTablePlan(adapter, input, signal);
  expect(next).toMatchObject({
    blueprint: {
      omitted: blueprint.omitted,
      tables: [{ fields: selected.fields }],
    },
  });
  selected.fields.push(blueprint.omitted[0].manualField!);
  const accepted = await generateTablePlan(adapter, input, signal);
  expect(accepted).toMatchObject({
    blueprint: {
      tables: [
        { fields: selected.fields, titleFieldId: '', view: { columnIds: [] } },
      ],
    },
  });
});
