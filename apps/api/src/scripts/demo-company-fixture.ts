import { randomUUID } from 'node:crypto';

import type {
  BusinessTemplateConfiguration,
  TemplateFieldConfiguration,
  TemplateObjectConfiguration,
} from '../modules/business-templates/business-template.schema';
import type {
  DashboardDefinitionV2,
  DashboardWidgetDraft,
} from '../modules/dashboards/dashboard.types';

export const DEMO_COMPANY_CODE = 'nebula-demo';
export const DEMO_TEMPLATE_CODE = 'standard-sales-demo';
export const DEMO_PASSWORD = 'Demo@123456';
export const DEMO_DASHBOARD_CONFIGURATION = {
  opportunity: {
    objectCode: 'opportunities',
    stageFieldKey: 'stage',
    amountFieldKey: 'amount',
    dateFieldKey: 'closeDate',
    activeOptionKeys: ['discovery', 'proposal', 'negotiation'],
    wonOptionKeys: ['won'],
    lostOptionKeys: ['lost'],
  },
  lead: { objectCode: 'leads' },
};

export interface DemoUser {
  displayName: string;
  phone: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  employeeNo: string;
}

export interface DemoRecord {
  objectCode: string;
  ownerEmployeeNo: string | null;
  title: string;
  statusKey: string | null;
  values: Record<string, string | number | boolean | null>;
}

export interface DemoCompanyFixture {
  company: { name: string; code: string };
  template: {
    name: string;
    code: string;
    description: string;
    configuration: BusinessTemplateConfiguration;
  };
  password: string;
  users: DemoUser[];
  records: DemoRecord[];
}

export function buildDemoCompanyFixture(): DemoCompanyFixture {
  const users: DemoUser[] = [
    companyUser('陈静', '18800001001', 'TENANT_ADMIN', 'ADM001'),
    companyUser('刘洋', '18800001002', 'TENANT_ADMIN', 'ADM002'),
    companyUser('赵晨', '18800001003', 'EMPLOYEE', 'EMP001'),
    companyUser('钱宇', '18800001004', 'EMPLOYEE', 'EMP002'),
    companyUser('孙悦', '18800001005', 'EMPLOYEE', 'EMP003'),
    companyUser('李昂', '18800001006', 'EMPLOYEE', 'EMP004'),
    companyUser('周岚', '18800001007', 'EMPLOYEE', 'EMP005'),
    companyUser('吴桐', '18800001008', 'EMPLOYEE', 'EMP006'),
    companyUser('郑凯', '18800001009', 'EMPLOYEE', 'EMP007'),
    companyUser('王宁', '18800001010', 'EMPLOYEE', 'EMP008'),
  ];
  const configuration: BusinessTemplateConfiguration = {
    schemaVersion: 1,
    objects: [
      templateObject(
        'leads',
        '销售线索',
        '员工收集并持续筛选的潜在客户信息。',
        10,
        'name',
        [
          field('name', '线索名称', 'TEXT', true, 10, { maxLength: 100 }),
          field('phone', '联系电话', 'PHONE', false, 20),
          field(
            'source',
            '线索来源',
            'SINGLE_SELECT',
            false,
            30,
            {},
            {
              options: selectOptions([
                ['website', '官网咨询'],
                ['referral', '客户转介绍'],
                ['event', '市场活动'],
              ]),
            },
          ),
          field(
            'status',
            '跟进状态',
            'SINGLE_SELECT',
            true,
            40,
            {},
            {
              options: selectOptions([
                ['new', '待联系'],
                ['contacted', '已联系'],
                ['qualified', '有效线索'],
              ]),
            },
          ),
          field('note', '线索备注', 'TEXTAREA', false, 50, {
            maxLength: 500,
          }),
        ],
      ),
      templateObject(
        'customers',
        '客户',
        '已经确认并进入持续经营阶段的客户档案。',
        20,
        'name',
        [
          field('name', '客户名称', 'TEXT', true, 10, { maxLength: 100 }),
          field('phone', '联系电话', 'PHONE', false, 20),
          field(
            'level',
            '客户等级',
            'SINGLE_SELECT',
            false,
            30,
            {},
            {
              options: selectOptions([
                ['a', 'A级'],
                ['b', 'B级'],
                ['c', 'C级'],
              ]),
            },
          ),
          field('industry', '所属行业', 'TEXT', false, 40),
          field('note', '客户备注', 'TEXTAREA', false, 50, {
            maxLength: 500,
          }),
        ],
      ),
      templateObject(
        'opportunities',
        '跟单商机',
        '销售人员正在推进的报价、方案和成交机会。',
        30,
        'name',
        [
          field('name', '商机名称', 'TEXT', true, 10, { maxLength: 100 }),
          field('amount', '预计金额', 'MONEY', false, 20, { scale: 2 }),
          field(
            'stage',
            '商机阶段',
            'SINGLE_SELECT',
            true,
            30,
            {},
            {
              options: selectOptions([
                ['discovery', '需求确认', 'BLUE'],
                ['proposal', '方案报价', 'CYAN'],
                ['negotiation', '商务谈判', 'ORANGE'],
                ['won', '已成交', 'GREEN'],
                ['lost', '已流失', 'RED'],
              ]),
            },
          ),
          field('closeDate', '预计成交日', 'DATE', false, 40),
          field('note', '推进说明', 'TEXTAREA', false, 50, {
            maxLength: 500,
          }),
        ],
      ),
      templateObject(
        'activities',
        '跟进活动',
        '电话、拜访、会议等客户触达记录。',
        40,
        'subject',
        [
          field('subject', '活动主题', 'TEXT', true, 10, { maxLength: 100 }),
          field(
            'activityType',
            '活动类型',
            'SINGLE_SELECT',
            true,
            20,
            {},
            {
              options: selectOptions([
                ['call', '电话'],
                ['visit', '拜访'],
                ['meeting', '会议'],
              ]),
            },
          ),
          field('happenedAt', '发生时间', 'DATETIME', true, 30),
          field('result', '跟进结果', 'TEXTAREA', false, 40, {
            maxLength: 500,
          }),
          field('nextDate', '下次跟进日', 'DATE', false, 50),
        ],
      ),
      templateObject(
        'contracts',
        '合同',
        '已经签署或正在履行的销售合同。',
        50,
        'name',
        [
          field('name', '合同名称', 'TEXT', true, 10, { maxLength: 100 }),
          field('contractNo', '合同编号', 'TEXT', true, 20, {
            maxLength: 64,
          }),
          field('amount', '合同金额', 'MONEY', true, 30, { scale: 2 }),
          field('signDate', '签署日期', 'DATE', false, 40),
          field(
            'status',
            '合同状态',
            'SINGLE_SELECT',
            true,
            50,
            {},
            {
              options: selectOptions([
                ['draft', '拟定中'],
                ['active', '履行中'],
                ['completed', '已完成'],
              ]),
            },
          ),
        ],
      ),
      templateObject(
        'payments',
        '回款',
        '合同对应的收款计划和实际到账记录。',
        60,
        'name',
        [
          field('name', '回款名称', 'TEXT', true, 10, { maxLength: 100 }),
          field('amount', '回款金额', 'MONEY', true, 20, { scale: 2 }),
          field('paymentDate', '回款日期', 'DATE', false, 30),
          field(
            'method',
            '回款方式',
            'SINGLE_SELECT',
            false,
            40,
            {},
            {
              options: selectOptions([
                ['transfer', '银行转账'],
                ['online', '线上支付'],
                ['other', '其他'],
              ]),
            },
          ),
          field('note', '回款备注', 'TEXTAREA', false, 50, {
            maxLength: 500,
          }),
        ],
      ),
    ],
  };

  return {
    company: { name: '星云科技演示公司', code: DEMO_COMPANY_CODE },
    template: {
      name: '标准销售协作演示模板',
      code: DEMO_TEMPLATE_CODE,
      description: '用于理解模板、公司业务表、成员权限和个人数据的完整演示。',
      configuration,
    },
    password: DEMO_PASSWORD,
    users,
    records: buildRecords(users.filter(({ role }) => role === 'EMPLOYEE')),
  };
}

function companyUser(
  displayName: string,
  phone: string,
  role: DemoUser['role'],
  employeeNo: string,
): DemoUser {
  return { displayName, phone, role, employeeNo };
}

function field(
  fieldKey: string,
  label: string,
  type: TemplateFieldConfiguration['type'],
  required: boolean,
  sortOrder: number,
  validation: TemplateFieldConfiguration['validation'] = {},
  config: TemplateFieldConfiguration['config'] = {},
): TemplateFieldConfiguration {
  return {
    id: randomUUID(),
    fieldKey,
    label,
    type,
    required,
    defaultValue: null,
    validation,
    config,
    sortOrder,
    isSystem: false,
    status: 'ACTIVE',
  };
}

function templateObject(
  code: string,
  name: string,
  description: string,
  sortOrder: number,
  titleFieldKey: string,
  fields: TemplateFieldConfiguration[],
): TemplateObjectConfiguration {
  return {
    id: randomUUID(),
    code,
    name,
    description,
    icon: null,
    titleFieldKey,
    sortOrder,
    status: 'ACTIVE',
    fields,
    defaultView: {
      code: 'default',
      name: `全部${name}`,
      columnFieldKeys: fields.map(({ fieldKey }) => fieldKey),
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: Object.fromEntries(
        fields.map(({ fieldKey }) => [fieldKey, 'EDIT' as const]),
      ),
    },
  };
}

function selectOptions(
  entries: Array<
    [
      key: string,
      label: string,
      color?:
        | 'GRAY'
        | 'BLUE'
        | 'CYAN'
        | 'GREEN'
        | 'YELLOW'
        | 'ORANGE'
        | 'RED'
        | 'PURPLE',
    ]
  >,
) {
  const palette = ['BLUE', 'CYAN', 'GREEN', 'ORANGE', 'PURPLE'] as const;
  return entries.map(([key, label, color], index) => ({
    key,
    label,
    color: color ?? palette[index % palette.length],
    status: 'ACTIVE',
  }));
}

function buildRecords(employees: DemoUser[]): DemoRecord[] {
  return employees.flatMap((employee, employeeIndex) =>
    [1, 2].flatMap((sequence) => {
      const serial = employeeIndex * 2 + sequence;
      const day = String(10 + ((serial - 1) % 18)).padStart(2, '0');
      const suffix = `${employee.displayName}-${sequence}`;
      const stage = ['discovery', 'proposal', 'negotiation', 'won', 'lost'][
        (serial - 1) % 5
      ];
      const closeDate = relativeDate(
        stage === 'won' || stage === 'lost'
          ? -(2 + (serial % 18))
          : serial % 3 === 0
            ? -(2 + (serial % 6))
            : 2 + (serial % 9),
      );
      return [
        demoRecord('leads', employee, `新线索 ${suffix}`, 'new', {
          name: `新线索 ${suffix}`,
          phone: `138${String(10000000 + serial).slice(-8)}`,
          source: ['website', 'referral', 'event'][serial % 3],
          status: 'new',
          note: `${employee.displayName}负责的待联系线索。`,
        }),
        demoRecord('customers', employee, `客户 ${suffix}`, null, {
          name: `客户 ${suffix}`,
          phone: `139${String(20000000 + serial).slice(-8)}`,
          level: ['a', 'b', 'c'][serial % 3],
          industry: ['制造业', '企业服务', '零售'][serial % 3],
          note: `由${employee.displayName}持续维护。`,
        }),
        demoRecord(
          'opportunities',
          serial === 1 ? null : employee,
          `数字化项目 ${suffix}`,
          stage,
          {
            name: `数字化项目 ${suffix}`,
            amount: 50000 + serial * 3500,
            stage,
            closeDate,
            note:
              stage === 'won'
                ? '客户已确认成交，合同与回款由后续业务表继续承接。'
                : stage === 'lost'
                  ? '本轮暂未成交，已记录流失结果。'
                  : '正在推进下一步，需要按预计成交日持续跟进。',
          },
        ),
        demoRecord('activities', employee, `客户沟通 ${suffix}`, null, {
          subject: `客户沟通 ${suffix}`,
          activityType: ['call', 'visit'][sequence - 1],
          happenedAt: `2026-08-${day}T09:30:00.000Z`,
          result: '客户确认继续推进，需准备下一版方案。',
          nextDate: `2026-09-${day}`,
        }),
        demoRecord('contracts', employee, `销售合同 ${suffix}`, 'active', {
          name: `销售合同 ${suffix}`,
          contractNo: `HT-2026-${String(serial).padStart(4, '0')}`,
          amount: 80000 + serial * 5000,
          signDate: `2026-08-${day}`,
          status: 'active',
        }),
        demoRecord('payments', employee, `首期回款 ${suffix}`, null, {
          name: `首期回款 ${suffix}`,
          amount: 30000 + serial * 2000,
          paymentDate: `2026-08-${day}`,
          method: 'transfer',
          note: '演示数据：首期款已登记。',
        }),
      ];
    }),
  );
}

function demoRecord(
  objectCode: string,
  owner: DemoUser | null,
  title: string,
  statusKey: string | null,
  values: DemoRecord['values'],
): DemoRecord {
  return {
    objectCode,
    ownerEmployeeNo: owner?.employeeNo ?? null,
    title,
    statusKey,
    values,
  };
}

function relativeDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function buildDemoDashboardDraft(): DashboardDefinitionV2 {
  const opportunity = {
    audience: 'ALL' as const,
    objectCode: DEMO_DASHBOARD_CONFIGURATION.opportunity.objectCode,
    filters: [] as DashboardWidgetDraft['filters'],
  };
  const activeStages = DEMO_DASHBOARD_CONFIGURATION.opportunity.activeOptionKeys;
  return {
    schemaVersion: 2,
    title: '销售运营工作台',
    widgets: [
      {
        ...opportunity,
        id: 'opportunity-total',
        type: 'METRIC',
        title: '商机总数',
        width: 'QUARTER',
        sortOrder: 0,
        aggregation: 'COUNT',
        displayFormat: 'NUMBER',
      },
      {
        ...opportunity,
        id: 'opportunity-amount',
        type: 'METRIC',
        title: '预计金额',
        width: 'QUARTER',
        sortOrder: 1,
        aggregation: 'SUM',
        valueFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
        displayFormat: 'MONEY',
      },
      {
        ...opportunity,
        id: 'opportunity-active',
        type: 'METRIC',
        title: '跟单商机',
        width: 'QUARTER',
        sortOrder: 2,
        aggregation: 'COUNT',
        displayFormat: 'NUMBER',
      },
      {
        ...opportunity,
        id: 'opportunity-won',
        type: 'METRIC',
        title: '成交金额',
        width: 'QUARTER',
        sortOrder: 3,
        aggregation: 'SUM',
        valueFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
        displayFormat: 'MONEY',
      },
      {
        ...opportunity,
        id: 'opportunity-trend',
        type: 'TREND',
        title: '预计成交趋势',
        width: 'HALF',
        sortOrder: 4,
        dateFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.dateFieldKey,
        granularity: 'MONTH',
        aggregation: 'SUM',
        valueFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
      },
      {
        ...opportunity,
        id: 'opportunity-pipeline',
        type: 'STATUS_DISTRIBUTION',
        title: '商机阶段',
        width: 'HALF',
        sortOrder: 5,
        groupByFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
        optionKeys: [
          ...activeStages,
          ...DEMO_DASHBOARD_CONFIGURATION.opportunity.wonOptionKeys,
          ...DEMO_DASHBOARD_CONFIGURATION.opportunity.lostOptionKeys,
        ],
        display: 'BAR',
        aggregation: 'SUM',
        valueFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
      },
      {
        ...opportunity,
        id: 'opportunity-leaderboard',
        type: 'LEADERBOARD',
        title: '负责人排行',
        width: 'HALF',
        sortOrder: 6,
        memberSource: 'RECORD_OWNER',
        aggregation: 'SUM',
        valueFieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
        limit: 10,
      },
      {
        ...opportunity,
        id: 'opportunity-records',
        type: 'RECORD_LIST',
        title: '近期商机',
        width: 'FULL',
        sortOrder: 7,
        fieldKeys: [
          DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
          DEMO_DASHBOARD_CONFIGURATION.opportunity.amountFieldKey,
          DEMO_DASHBOARD_CONFIGURATION.opportunity.dateFieldKey,
        ],
        sort: { field: 'updatedAt', direction: 'DESC' },
        limit: 10,
      },
    ],
  };
}
