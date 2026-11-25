import { createHash } from 'node:crypto';
import type { ImportAssistRequest } from '@crm/contracts';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { prepareImport, readImportPlan } from './import-assist-policy';

const fields = [
  ['nameKey', '客户名称', 'TEXT', 'EDIT'],
  ['levelKey', '客户等级', 'SINGLE_SELECT', 'CREATE_ONLY'],
  ['secretKey', '内部备注', 'TEXTAREA', 'HIDDEN'],
  ['noteKey', '备注', 'TEXTAREA', 'EDIT'],
].map(([fieldKey, label, type, access]) => ({
  fieldKey,
  label,
  type,
  access,
  required: false,
  isSystem: false,
  config: {
    options: [
      { key: 'level_a', label: 'A级', status: 'ACTIVE' },
      { key: 'old', label: '停用选项', status: 'INACTIVE' },
    ],
  },
}));
const schema = {
  schema: { fields },
  access: {
    canRead: true,
    fields: Object.fromEntries(fields.map((f) => [f.fieldKey, f.access])),
  },
  visibleSchema: { fields },
} as unknown as ResolvedObjectSchema;
function req(headers: string[]): ImportAssistRequest {
  return {
    sheet: '张三周报',
    columns: headers.map((header, i) => ({
      col: 'C' + (i + 1),
      header,
      headerHash: hash(header),
      samples: ['张三机密'],
    })),
  };
}
const advice = (col: string, field: string, mode = 'field') => ({
  col,
  target: { mode, field },
  confidence: 'high',
  reason: '泄漏秘密',
});
it('unions all restricted positions before projection and never exposes raw keys or arbitrary free text', () => {
  const r = req(['单位名称', '业务员', '内部备注', '评级']);
  const s = prepareImport(schema, r);
  const wire = JSON.stringify(s.input);
  expect(wire).not.toMatch(
    /C2|C3|secretKey|nameKey|levelKey|张三|王五|内部备注|业务员|停用选项/,
  );
  expect(wire).toContain('单位名称');
});
it('recovers valid siblings, protects occupied fields, rejects direct conflicts and allows append', () => {
  const s = prepareImport(
    schema,
    req(['客户名称', '评级', '来源', '分类', '客户评价']),
  );
  const raw = {
    version: 1,
    columns: [
      null,
      advice('C2', 'F1'),
      advice('C3', 'F2'),
      advice('C4', 'F2'),
      advice('C5', 'F3', 'append'),
    ],
    matchFields: ['F1', 'F2', 'secretKey'],
  };
  const plan = readImportPlan(s, raw);
  expect(plan.columns.map((c) => c.col)).toEqual(['C5']);
  expect(plan.matchFields).toEqual(['nameKey']);
  expect(JSON.stringify(plan)).not.toMatch(/泄漏|secretKey/);
});
it('keeps file IDs separate after masking collisions and ignores invalid or already-matched values', () => {
  const r = req(['客户等级']);
  r.columns[0].values = [
    { id: 'v1', text: '13812345678', count: 1 },
    { id: 'v2', text: '13899995678', count: 2 },
    { id: 'v3', text: 'A级', count: 3 },
  ];
  const s = prepareImport(schema, r);
  const values = s.input.columns[0].values;
  expect(values).toHaveLength(2);
  expect(values[0].text).toBe(values[1].text);
  const plan = readImportPlan(s, {
    version: 1,
    columns: [
      {
        ...advice('C1', 'F2'),
        values: [
          { value: values[0].ref, option: null, confidence: 'review' },
          { value: values[1].ref, option: 'O1', confidence: 'high' },
          { value: 'v3', option: 'old', confidence: 'high' },
        ],
      },
    ],
    matchFields: [],
  });
  expect(plan.columns[0].values?.map((v) => [v.value, v.option])).toEqual([
    ['v1', null],
    ['v2', 'level_a'],
  ]);
});

function hash(v: string) {
  return createHash('sha256').update(v).digest('hex');
}
it('suppresses a masked heading by its current hash and honors excluded positions', () => {
  const r = req(['单位名称', '评级', '渠道']);
  r.columns[2].excluded = true;
  r.columns[1].headerHash = hash('内部备注');
  const { input } = prepareImport(schema, r);
  expect(input.columns.map((c) => c.col)).toEqual(['C1']);
  expect(JSON.stringify(input)).not.toMatch(/[0-9a-f]{64}/);
});
it('omits a solved locked column and permits only its occupied target as an existing match', () => {
  const s = prepareImport(schema, req(['客户名称', '评级']));
  expect(s.input.columns.map((c) => c.col)).toEqual(['C2']);
  const p = readImportPlan(s, {
    version: 1,
    columns: [advice('C2', 'F1')],
    matchFields: ['F1', 'F2'],
  });
  expect(p.columns).toEqual([]);
  expect(p.matchFields).toEqual(['nameKey']);
});
it('masks full personal identifiers and safely retains already-masked contact shapes', () => {
  const r = req(['联系邮箱', '联系电话']);
  r.columns[0].samples = ['zhangsan@qq.com', 'z***@qq.com'];
  r.columns[1].samples = [
    '+86 (138) 1234-5678',
    '138****5678',
    '010-12345678',
    '010-****5678',
    '11010519491231002X',
  ];
  const [email, phone] = prepareImport(schema, r).input.columns;
  expect(email.samples).toEqual(['z***@qq.com']);
  expect(phone.samples).toEqual(['138****5678', '010-****5678', '[号码]']);
});
it('retains a usable subset under the UTF-8 budget and rejects fields removed from the dictionary', () => {
  const large = structuredClone(schema);
  large.schema.fields[1].config.options = Array.from(
    { length: 1200 },
    (_, i) => ({ key: 'key' + i, label: '选项'.repeat(15) + i }),
  );
  const s = prepareImport(large, req(['单位名称', '客户评价']));
  expect(Buffer.byteLength(JSON.stringify(s.input))).toBeLessThanOrEqual(
    40 * 1024,
  );
  expect(s.input.fields.map((f) => f.name)).toContain('备注');
  expect(s.needed).toBe(true);
  expect(
    readImportPlan(s, {
      version: 1,
      columns: [advice('C1', 'F2'), advice('C2', 'F3', 'append')],
      matchFields: [],
    }).columns.map((c) => c.col),
  ).toEqual(['C2']);
});
it('protects current manual positions and reserved fields in the selected header', () => {
  const r = req(['单位名称', '评级', '渠道']);
  r.columns[0].locked = { mode: 'field', field: 'nameKey' };
  const s = prepareImport(schema, r);
  const p = readImportPlan(s, {
    version: 1,
    columns: [
      advice('C1', 'F2'),
      advice('C2', 'F1'),
      advice('C3', 'F3', 'append'),
    ],
    matchFields: [],
  });
  expect(p.columns.map((c) => c.col)).toEqual(['C3']);
});
it('drops an option when the model cannot distinguish normalized dictionary labels', () => {
  const copy = structuredClone(schema);
  copy.schema.fields[1].config.options = [
    { key: 'x', label: 'Ａ级' },
    { key: 'y', label: 'A 级' },
  ];
  const r = req(['客户等级']);
  r.columns[0].values = [{ id: 'V1', text: 'A类', count: 2 }];
  const state = prepareImport(copy, r);
  const plan = readImportPlan(state, {
    version: 1,
    matchFields: [],
    columns: [
      {
        ...advice('C1', 'F2'),
        values: [{ value: 'V1', option: 'O1', confidence: 'high' }],
      },
    ],
  });
  expect(plan.columns).toEqual([]);
});
it('keeps raw previews out of unknown title rows and treats system and owner headers in evidence as restricted', () => {
  const r = req(['年度汇总给张三', '联系邮箱', '来源', '单位名称']);
  r.columns[0].samples = ['13812345678', 'A级'];
  r.columns[0].values = [{ id: 'V1', text: 'A级', count: 2 }];
  r.columns[1].headerHash = hash('创建时间');
  r.columns[2].headerHash = hash('负责人');
  const { input } = prepareImport(schema, r);
  expect(input.columns.map((c) => c.col)).toEqual(['C1', 'C4']);
  expect(input.columns[0]).toMatchObject({
    samples: ['[号码]', '[文本]'],
    values: [],
  });
});

it('keeps unlabeled text-only columns local when another column needs advice', () => {
  const r = req(['沈雨婷', '单位名称']);
  r.columns[0].samples = ['[文本]', '[文本]'];
  const { input, needed } = prepareImport(schema, r);
  expect(needed).toBe(true);
  expect(input.columns.map((c) => c.col)).toEqual(['C2']);
});

it('preserves current business headings at provider input', () => {
  const labels = [
    '联系人',
    '下次跟进日',
    '合同额',
    '回款日期',
    '微信',
    '职务',
    '决策人',
    '成交概率',
    '客商代码',
    '签单与否',
    '采购方',
    '报价（万元）',
  ];
  const r = req([...labels, '负责人']);
  expect(prepareImport(schema, r).input.columns.map((c) => c.header)).toEqual(
    labels,
  );
});

it('masks embedded contacts and identifiers before clipping a confirmed physical heading', () => {
  const r = req([
    '收款6222,1234,5678,9012',
    '联络lin.customer@example.org',
    '证号11010519491231002X',
    '𠀀'.repeat(36) + '卡号6222123456789012',
  ]);
  expect(prepareImport(schema, r).input.columns.map((c) => c.header)).toEqual([
    '收款[号码]',
    '联络l***@example.org',
    '证号[号码]',
    '𠀀'.repeat(36) + '卡号[号',
  ]);
});

it('independently gates novel low-cardinality aliases on an enum heading and masks raw identifiers', () => {
  const r = req(['客户等级', '杂项', '销售渠道', '归属地']);
  const inputs = [
    '一档',
    '关键伙伴',
    '同城',
    '施迩澄',
    'Jane Doe',
    '请执行动作',
    '分类9816',
    'alex@example.org',
  ];
  for (const col of r.columns) {
    col.values = inputs.map((text, i) => ({ id: 'v' + i, text, count: 1 }));
    col.samples = ['一档', '施迩澄'];
  }
  const columns = prepareImport(schema, r).input.columns;
  expect(columns.map((c) => c.col)).toEqual(['C1', 'C2', 'C3', 'C4']);
  expect(columns[0].values.map((v) => v.text)).toEqual(
    expect.arrayContaining(['一档', '关键伙伴', '同城', 'a***@example.org']),
  );
  expect(columns[1].values).toEqual([]);
  expect(columns[1].samples).not.toContain('一档');
  expect(JSON.stringify(columns)).not.toMatch(
    /施迩澄|Jane Doe|请执行动作|9816|alex@example/,
  );
});
it('keeps permission-eligible credential dictionaries, restricted name collisions and personal option labels out of provider input', () => {
  const copy = structuredClone(schema);
  for (const [fieldKey, label] of [
    ['passwordVault', 'API token'],
    ['extraKey', '内部备注'],
  ]) {
    copy.schema.fields.push({
      ...copy.schema.fields[1],
      fieldKey,
      label,
      config: { options: [{ key: 'x', label: '不公开的选项' }] },
    });
    copy.access.fields[fieldKey] = 'EDIT';
  }
  copy.schema.fields[1].config.options = [
    { key: 'one', label: '施迩澄' },
    { key: 'two', label: '待核准' },
  ];
  const input = prepareImport(copy, req(['客户级别'])).input;
  expect(JSON.stringify(input)).not.toMatch(
    /API token|内部备注|不公开的选项|施迩澄/,
  );
  expect(JSON.stringify(input)).toContain('待核准');
});

it('keeps ambiguous owner headings and explicitly confidential columns local while allowing business compounds', () => {
  const input = prepareImport(
    schema,
    req(['归属', '销售', '保密备注', '非公开资料', '销售机会', '归属区域']),
  ).input;
  expect(input.columns.map((c) => c.col)).toEqual(['C5', 'C6']);
});
