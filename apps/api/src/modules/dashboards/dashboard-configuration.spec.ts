import type { PublishedObjectSchema } from '../objects/object-schema';
import {
  parseDashboardConfiguration,
  validateDashboardConfiguration,
} from './dashboard-configuration';

const opportunity = {
  publication: {
    id: 'publication-1',
    number: 1,
    sourceDraftVersion: 1,
    publishedAt: '2026-08-31T00:00:00.000Z',
  },
  object: {
    id: 'object-1',
    code: 'opportunities',
    name: '商机',
    description: null,
    titleFieldKey: 'name',
    icon: null,
    sortOrder: 1,
  },
  fields: [
    field('name', '商机名称', 'TEXT'),
    field('stage', '阶段', 'SINGLE_SELECT', {
      options: [
        { key: 'new', label: '新商机', color: 'BLUE', status: 'ACTIVE' },
        { key: 'proposal', label: '方案中', color: 'CYAN', status: 'ACTIVE' },
        { key: 'won', label: '已成交', color: 'GREEN', status: 'ACTIVE' },
        { key: 'lost', label: '已失败', color: 'RED', status: 'ACTIVE' },
      ],
    }),
    field('amount', '预计金额', 'MONEY'),
    field('close_at', '成交日期', 'DATE'),
  ],
  defaultView: {
    code: 'default',
    name: '默认列表',
    columnFieldKeys: ['name', 'stage', 'amount'],
    sort: { field: 'updatedAt', direction: 'desc' },
  },
  employeeAccess: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    readScope: 'OWN',
    updateScope: 'OWN',
    fields: {
      name: 'EDIT',
      stage: 'EDIT',
      amount: 'EDIT',
      close_at: 'EDIT',
    },
  },
} satisfies PublishedObjectSchema;

const validConfiguration = {
  opportunity: {
    objectCode: 'opportunities',
    stageFieldKey: 'stage',
    amountFieldKey: 'amount',
    dateFieldKey: 'close_at',
    activeOptionKeys: ['new', 'proposal'],
    wonOptionKeys: ['won'],
    lostOptionKeys: ['lost'],
  },
};

describe('dashboard configuration', () => {
  it('parses the exact supported shape and accepts published compatible fields', () => {
    const parsed = parseDashboardConfiguration(validConfiguration);

    expect(parsed).toEqual(validConfiguration);
    expect(validateDashboardConfiguration(parsed, [opportunity])).toEqual([]);
  });

  it('rejects unknown configuration keys', () => {
    expect(() =>
      parseDashboardConfiguration({
        ...validConfiguration,
        guessedAmount: true,
      }),
    ).toThrow('Invalid dashboard configuration');
  });

  it('reports a missing published object', () => {
    expect(
      validateDashboardConfiguration(validConfiguration, []),
    ).toContainEqual(
      expect.objectContaining({ code: 'OPPORTUNITY_OBJECT_NOT_FOUND' }),
    );
  });

  it('reports incompatible stage and amount fields', () => {
    const invalid = {
      ...opportunity,
      fields: [
        field('name', '商机名称', 'TEXT'),
        field('stage', '阶段', 'TEXT'),
        field('amount', '预计金额', 'TEXT'),
        field('close_at', '成交日期', 'DATE'),
      ],
    } satisfies PublishedObjectSchema;

    expect(
      validateDashboardConfiguration(validConfiguration, [invalid]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'STAGE_FIELD_TYPE_INVALID' }),
        expect.objectContaining({ code: 'AMOUNT_FIELD_TYPE_INVALID' }),
      ]),
    );
  });

  it('reports stage option keys that are absent from the active publication', () => {
    const configuration = {
      ...validConfiguration,
      opportunity: {
        ...validConfiguration.opportunity,
        wonOptionKeys: ['won_elsewhere'],
      },
    };

    expect(
      validateDashboardConfiguration(configuration, [opportunity]),
    ).toContainEqual(
      expect.objectContaining({
        code: 'STAGE_OPTION_NOT_FOUND',
        path: 'opportunity.wonOptionKeys',
      }),
    );
  });
});

function field(
  fieldKey: string,
  label: string,
  type: PublishedObjectSchema['fields'][number]['type'],
  config: PublishedObjectSchema['fields'][number]['config'] = {},
): PublishedObjectSchema['fields'][number] {
  return {
    id: `field-${fieldKey}`,
    fieldKey,
    label,
    type,
    required: false,
    defaultValue: null,
    validation: {},
    config,
    sortOrder: 1,
    isSystem: false,
  };
}
