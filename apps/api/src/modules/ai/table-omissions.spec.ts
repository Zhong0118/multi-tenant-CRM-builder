import { randomUUID } from 'node:crypto';
import type { BlueprintFieldType, TablePlan } from '@crm/contracts';
import { normalizeOmissions } from './table-omissions';
import type { TableModelOutput } from './table-model';

function table(
  name: string,
  labels: Record<string, BlueprintFieldType>,
): TablePlan {
  const fields = Object.entries(labels).map(([label, type], n) => ({
    id: randomUUID(),
    fieldKey: 'field_' + n,
    label,
    type,
    required: n === 0,
    reason: '识别业务记录',
  }));
  return {
    id: randomUUID(),
    code: 'business',
    name,
    reason: '测试业务',
    fields,
    titleFieldId: fields[0].id,
    view: { columnIds: fields.map((f) => f.id), reason: '测试列表' },
    employeeIntent: [],
  };
}

type RawOmission = TableModelOutput['omitted'][number];
// Frozen inputs from the first DeepSeek failure audit. The current report may change.
const historic: {
  id: string;
  draftFields: Record<string, Record<string, BlueprintFieldType>>;
  omitted: Pick<RawOmission, 'request' | 'reason' | 'alternative'>[];
}[] = [
  {
    id: 'dev-10',
    draftFields: {
      维修: {
        维修名称: 'TEXT',
        含税费用: 'MONEY',
        维修日期: 'DATE',
        客户名称: 'TEXT',
      },
    },
    omitted: [
      {
        request: '自动计算的含税费用',
        reason: '不支持公式、计算字段与自动派生数值，金额必须由人工录入。',
        alternative:
          '保留“含税费用”为手工填写的金额字段；若需要由不含税金额与税率推算，可增加“不含税金额”“税率”两个人工字段，计费时在表外（如导出表格或财务系统）计算，再把结果回填到“含税费用”。',
      },
      {
        request: '备注说明、维修附件、后续跟进、与客户/合同的记录关联',
        reason:
          '这些能力由平台内置功能提供，不属于可自定义的业务字段，也不在本计划中建模。',
        alternative:
          '使用记录详情页内置的备注、附件上传、跟进活动与记录关联功能来补充这些信息；合同到期日属于合同表的日期字段，与跟进活动是不同概念，请分开记录。',
      },
    ],
  },
  {
    id: 'dev-11',
    draftFields: {
      报价: {
        报价名称: 'TEXT',
        对应客户: 'TEXT',
        报价日期: 'DATE',
        有效期至: 'DATE',
        报价金额: 'MONEY',
        报价状态: 'SINGLE_SELECT',
        报价说明: 'TEXTAREA',
      },
    },
    omitted: [
      {
        request: '关联客户记录的关系字段「对应客户」',
        reason:
          '当前不支持关系/查找字段，也不能使用记录 ID 或系统关联配置来建立关联。',
        alternative:
          '由管理员在平台中手动配置与客户记录的原生关联；或先使用文本字段「对应客户」记录客户名称。',
      },
    ],
  },
  {
    id: 'holdout-10',
    draftFields: {
      摊位报价: {
        报价主题: 'TEXT',
        客户名称: 'TEXT',
        展会名称: 'TEXT',
        报价日期: 'DATE',
        对客报价: 'MONEY',
        预计成本: 'MONEY',
        预计毛利: 'MONEY',
      },
    },
    omitted: [
      {
        request:
          '预计毛利自动等于「对客报价 − 预计成本」，改价后自动更新，员工不用手填',
        reason:
          '当前字段类型中不提供公式、计算或自动重算能力，因此不能在该表内实现自动相减与联动更新。',
        alternative:
          '先保留「预计毛利」为金额字段由人工填写；或定期把报价与成本导出到表格中计算毛利后再回填；也可在后续支持计算字段时再改为自动计算。',
      },
      {
        request: '每次修改价格时自动触发更新（自动化/工作流）',
        reason: '本方案不包含自动化、工作流或触发器的设计。',
        alternative:
          '如需自动提醒或联动，可在平台外以报表导出加人工核对的方式处理，待有自动化能力时再配置。',
      },
      {
        request: '员工端不显示/不需填写某些字段的人员范围控制',
        reason:
          '本方案不涉及权限、可见性或系统标志的设计；相关内容已作为员工端诉求记录，需管理员手动配置。',
        alternative: '由管理员在员工角色配置中手动调整表单显示与可填写字段。',
      },
    ],
  },
];

it.each([
  ['dev-10', '含税费用'],
  ['dev-11', '对应客户'],
  ['holdout-10', '预计毛利'],
])(
  'suppresses only the substitute field in the recorded %s output',
  (id, label) => {
    const sample = historic.find((s) => s.id === id)!;
    const [[name, labels]] = Object.entries(sample.draftFields);
    const t = table(name, labels);
    const suppressed = t.fields.find((f) => f.label === label)!;
    const omitted = normalizeOmissions(
      sample.omitted.map((o) => ({ ...o, manualField: null, tableName: null })),
      [t],
    );
    expect(t.fields.map((f) => f.label)).toEqual(
      Object.keys(labels).filter((v) => v !== label),
    );
    expect(t.view.columnIds).not.toContain(suppressed.id);
    expect(
      omitted.find((o) => o.manualField?.id === suppressed.id),
    ).toMatchObject({
      tableId: t.id,
      manualField: {
        id: suppressed.id,
        label,
        required: false,
        type: labels[label],
      },
    });
  },
);

it('limits a normalized match to its table, removes title references, and prioritizes the requested label over an incorrect suggestion', () => {
  const quote = table('报价', { 'ＮＥＴ   TOTAL': 'MONEY', Cost: 'MONEY' });
  const sale = table('Sale', { 'Net total': 'MONEY' });
  const omission: RawOmission = {
    request: 'net total',
    reason: 'No formulas',
    alternative: null,
    tableName: '报价',
    manualField: { label: 'Cost', type: 'NUMBER', fieldKey: 'cost' },
  };
  const omitted = normalizeOmissions([omission], [quote, sale]);
  expect(quote.fields.map((f) => f.label)).toEqual(['Cost']);
  expect(quote.titleFieldId).toBe('');
  expect(sale.fields).toHaveLength(1);
  expect(omitted[0].manualField?.label).toBe('ＮＥＴ   TOTAL');
});

it('supports an optional manual alternative when the model already withheld the substitute, and preserves only an explicitly restored field on refinement', () => {
  const t = table('Quote', { Name: 'TEXT' });
  const omission: RawOmission = {
    request: 'Tax',
    reason: 'No formulas',
    alternative: 'Enter manually',
    tableName: 'Quote',
    manualField: { label: 'Tax', type: 'MONEY', fieldKey: 'tax' },
  };
  const omitted = normalizeOmissions([omission], [t]);
  const manual = omitted[0].manualField!;
  const candidate = structuredClone(t);
  candidate.fields.push({ ...manual, id: randomUUID() });
  normalizeOmissions([], [candidate], omitted, t);
  expect(candidate.fields.map((f) => f.label)).toEqual(['Name']);
  t.fields.push(manual);
  const accepted = structuredClone(t);
  const refined = normalizeOmissions([omission], [accepted], omitted, t);
  expect(accepted.fields).toEqual(t.fields);
  expect(refined).toHaveLength(1);
});

it('recognizes the requested label in prose even if the suggested target is wrong, while protecting partial words', () => {
  const t = table('Sale', { Margin: 'MONEY', Tax: 'MONEY', ICE: 'TEXT' });
  const omitted = normalizeOmissions(
    [
      {
        request: 'Auto-calculated margin',
        reason: 'No formulas',
        alternative: null,
        tableName: 'Sale',
        manualField: { label: 'Tax', fieldKey: 'tax', type: 'MONEY' },
      },
      {
        request: 'invoice',
        reason: 'Billing workflow',
        alternative: 'Manage the invoice in the ledger',
        tableName: null,
        manualField: null,
      },
    ],
    [t],
  );
  expect(t.fields.map((f) => f.label)).toEqual(['Tax', 'ICE']);
  expect(omitted[0].manualField?.label).toBe('Margin');
  expect(omitted[1].manualField).toBeUndefined();
});

it('flags an ambiguous unscoped target instead of silently dropping a same-named field from another table', () => {
  const tables = [
    table('Quote', { Margin: 'MONEY' }),
    table('Invoice', { Margin: 'MONEY' }),
  ];
  const omitted = normalizeOmissions(
    [
      {
        request: 'Margin',
        reason: 'No formulas',
        alternative: null,
        tableName: null,
        manualField: null,
      },
    ],
    tables,
  );
  expect(omitted).toHaveLength(1);
  expect(omitted[0].alternative).toContain('请确认');
  expect(omitted[0].reason).toBe('No formulas');
  expect(omitted[0].manualField).toBeUndefined();
  expect(tables.every((t) => t.fields.length === 1)).toBe(true);
});

it('keeps a tableless manual suggestion informational while processing a separate, resolvable omission', () => {
  const quote = table('Quote', { Name: 'TEXT', Tax: 'MONEY' });
  const invoice = table('Invoice', { Name: 'TEXT' });
  const ambiguous: RawOmission = {
    request: 'Discount',
    reason: 'Calculated',
    tableName: null,
    alternative: null,
    manualField: { label: 'Discount', fieldKey: 'discount', type: 'MONEY' },
  };
  const omitted = normalizeOmissions(
    [
      ambiguous,
      {
        request: 'Tax',
        reason: 'Calculated',
        tableName: 'Quote',
        alternative: null,
        manualField: null,
      },
    ],
    [quote, invoice],
  );
  expect(omitted[0].alternative).toContain('请确认');
  expect(omitted[0].manualField).toBeUndefined();
  expect(omitted[1].manualField?.label).toBe('Tax');
  expect(quote.fields.map((f) => f.label)).toEqual(['Name']);
  expect(invoice.fields.map((f) => f.label)).toEqual(['Name']);
});
