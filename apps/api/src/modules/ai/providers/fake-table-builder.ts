import type {
  ModelField,
  ModelTable,
  TableModelOutput,
  TableProviderInput,
} from '../table-model';

function field(
  ref: string,
  label: string,
  type: string,
  reason: string,
  options: string[] = [],
): ModelField {
  return {
    ref: 'new:' + ref,
    label,
    type,
    reason,
    required: false,
    validation: null,
    options: options.map((label, i) => ({
      ref: 'new:choice' + i,
      label,
      reason: '供录入时选择。',
    })),
  };
}
function table(name: string, fields: ModelField[], reason: string): ModelTable {
  fields[0].required = true;
  return {
    name,
    fields,
    description: null,
    icon: null,
    reason,
    titleRef: fields[0].ref,
    columnRefs: fields.slice(0, 4).map((f) => f.ref),
    viewReason: '列表优先展示识别记录和办理业务所需的信息。',
    employeeIntent: [],
  };
}
function rentalTables(): ModelTable[] {
  return [
    table(
      '客户',
      [
        field('name', '客户名称', 'TEXT', '用于识别客户。'),
        field('phone', '联系电话', 'PHONE', '联系客户时使用。'),
        field('email', '电子邮箱', 'EMAIL', '接收业务通知。'),
      ],
      '保存承租客户的联系资料。',
    ),
    table(
      '合同',
      [
        field('name', '合同名称', 'TEXT', '用于识别合同。'),
        field('rent', '租金', 'MONEY', '登记约定的租赁金额。'),
        field('end', '合同到期日', 'DATE', '记录租赁合同的结束日期。'),
        field('state', '合同状态', 'SINGLE_SELECT', '跟踪合同办理进度。', [
          '草拟',
          '履行中',
          '已结束',
        ]),
        field('note', '备注', 'TEXTAREA', '记录其他约定。'),
      ],
      '登记租赁合同及履约期限。',
    ),
    table(
      '设备',
      [
        field('name', '设备名称', 'TEXT', '用于识别出租设备。'),
        field('model', '设备型号', 'TEXT', '标明具体设备规格。'),
        field('state', '设备状态', 'SINGLE_SELECT', '跟踪设备可用性。', [
          '可租',
          '已出租',
          '维修中',
        ]),
      ],
      '管理可出租的设备。',
    ),
    table(
      '回款',
      [
        field('name', '回款名称', 'TEXT', '识别收款记录。'),
        field('amount', '回款金额', 'MONEY', '核对实际收到的金额。'),
        field('on', '回款日期', 'DATE', '按日期核对到账记录。'),
      ],
      '逐笔登记回款。',
    ),
  ];
}
const englishCustomer = () =>
  table(
    'Customers',
    [
      field('name', 'Customer name', 'TEXT', 'Identifies the customer.'),
      field('phone', 'Phone', 'PHONE', 'Stores the customer contact number.'),
      field('email', 'Email', 'EMAIL', 'Stores the contact email address.'),
    ],
    'Manage customer contact details.',
  );

// These small scripts exercise the same wire format as the external provider.
// Unsupported fake scenarios abstain instead of inventing a plausible answer.
export function fakeTableBlueprint(
  input: TableProviderInput,
): TableModelOutput {
  const { description: text } = input;
  const output: TableModelOutput = {
    needsDetails: false,
    tables: [],
    assumptions: [],
    omitted: [],
  };
  if (text.includes('模拟服务不可用'))
    throw new Error('Fake provider unavailable');
  if (input.mode === 'refine' && input.table) {
    const updated = structuredClone(input.table);
    if (
      /签约日期/.test(text) &&
      !updated.fields.some((f) => f.label === '签约日期')
    )
      updated.fields.push(
        field('signed', '签约日期', 'DATE', '记录双方签订合同的日期。'),
      );
    if (/(?:去掉|删除|移除)(?:字段)?[「“]?备注/.test(text))
      updated.fields = updated.fields.filter((f) => f.label !== '备注');
    updated.columnRefs = updated.columnRefs.filter((ref) =>
      updated.fields.some((f) => f.ref === ref),
    );
    output.tables = [updated];
    return output;
  }
  if (input.targetName) {
    const fields: ModelField[] = [];
    if (/来源/.test(text))
      fields.push(
        field('source', '来源', 'SINGLE_SELECT', '按获客渠道分类。', [
          '转介绍',
          '线上咨询',
          '线下活动',
          '其他',
        ]),
      );
    if (/行业/.test(text))
      fields.push(field('industry', '行业', 'TEXT', '记录客户所属行业。'));
    if (/规模/.test(text))
      fields.push(
        field('size', '规模', 'SINGLE_SELECT', '按客户企业规模分组。', [
          '小型',
          '中型',
          '大型',
        ]),
      );
    output.tables = [
      {
        name: input.targetName,
        description: null,
        icon: null,
        reason: '补充目标表需要采集的信息。',
        titleRef: null,
        columnRefs: [],
        viewReason: '沿用目标表当前视图。',
        employeeIntent: [],
        fields,
      },
    ];
    return output;
  }
  const explicitEntities = input.answers.find(
    (a) => a.key === 'entities',
  )?.label;
  const vague =
    /^(?:请|帮我|想|我想|我们想|用AI|用 AI )*(?:建表|建个表|搭个系统|管理业务|管理客户业务|做一个CRM|建一个CRM|建一个业务管理系统|建一张业务表|建个业务表|搭建CRM|建一个系统)[。！!？? ]*$/iu.test(
      text,
    );
  if (
    input.mayAsk &&
    (vague ||
      (!/租赁|客户|合同|设备|回款|customers?/iu.test(text) &&
        !explicitEntities))
  ) {
    output.needsDetails = true;
    return output;
  }
  if (explicitEntities) {
    const selected = rentalTables().find((t) => t.name === explicitEntities);
    output.tables = selected
      ? [selected]
      : [
          table(
            explicitEntities,
            [field('name', '名称', 'TEXT', '作为业务记录的标题。')],
            '管理所选业务资料。',
          ),
        ];
    output.assumptions = [
      '先按所选主要实体建立一张表，可在确认前补充其他字段。',
    ];
  } else if (/customers?/i.test(text)) {
    output.tables = [englishCustomer()];
  } else if (
    /设备租赁|租赁设备/.test(text) &&
    !/(?:只|仅)(?:建|要|需要|管理)/.test(text)
  ) {
    output.tables = rentalTables();
  } else {
    output.tables = rentalTables().filter((t) => text.includes(t.name));
  }
  if (/销售.*(?:自己的|本人)|仅.*本人/.test(text))
    for (const t of output.tables)
      t.employeeIntent.push({
        request: '销售只能看自己的记录',
        reason: '草稿默认隐藏全部字段，管理员可在发布前配置员工权限。',
      });
  const capabilities = [
    {
      test: /毛利|公式|自动计算/,
      request: '毛利公式',
      alternative: '可选择手工录入金额。',
    },
    {
      test: /关联客户|客户关联|关联记录/,
      request: '关联客户',
      alternative: '使用记录关联。',
    },
    { test: /附件/, request: '附件', alternative: '使用记录附件区。' },
    { test: /负责人/, request: '负责人', alternative: '使用记录负责人。' },
    {
      test: /跟进记录|下次跟进/,
      request: '跟进记录',
      alternative: '使用记录的跟进待办。',
    },
  ];
  for (const entry of capabilities)
    if (entry.test.test(text))
      output.omitted.push({
        request: entry.request,
        reason: '使用已有平台能力或手动配置。',
        alternative: entry.alternative,
      });
  if (!output.tables.length && !output.omitted.length)
    output.omitted.push({
      request: text.slice(0, 1000),
      reason: '本地模拟器未提供该业务的示例方案。',
      alternative: null,
    });
  return output;
}
