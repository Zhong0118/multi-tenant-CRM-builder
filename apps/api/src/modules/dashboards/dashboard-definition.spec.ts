import type { PublishedObjectSchema } from '../objects/object-schema';
import {
  compileDashboardPublication,
  migrateLegacyDashboard,
  normalizeDashboardDraft,
  parseDashboardDraft,
  validateDashboardDraft,
} from './dashboard-definition';

const opportunity = {
  publication: {
    id: 'publication-opportunity-v7',
    number: 7,
    sourceDraftVersion: 4,
    publishedAt: '2026-09-01T00:00:00.000Z',
  },
  object: {
    id: 'object-opportunity',
    code: 'opportunity',
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
        { key: 'won', label: '已成交', color: 'GREEN', status: 'ACTIVE' },
        { key: 'lost', label: '已失败', color: 'RED', status: 'ACTIVE' },
      ],
    }),
    field('amount', '预计金额', 'MONEY'),
    field('close_at', '成交日期', 'DATE'),
    field('closed_at', '成交时间', 'DATETIME'),
    field('approved', '已审核', 'BOOLEAN'),
    field('owner', '负责人', 'MEMBER'),
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
      owner: 'EDIT',
    },
  },
} satisfies PublishedObjectSchema;

const completeDraft = {
  schemaVersion: 2,
  title: '销售工作台',
  widgets: [
    {
      id: 'metric-total',
      type: 'METRIC',
      title: '商机总数',
      audience: 'ALL',
      objectCode: 'opportunity',
      width: 'QUARTER',
      sortOrder: 20,
      filters: [],
      aggregation: 'COUNT',
      displayFormat: 'NUMBER',
    },
    {
      id: 'pipeline',
      type: 'STATUS_DISTRIBUTION',
      title: '商机漏斗',
      audience: 'ALL',
      objectCode: 'opportunity',
      width: 'HALF',
      sortOrder: 10,
      filters: [],
      groupByFieldKey: 'stage',
      optionKeys: ['new', 'won', 'lost'],
      display: 'FUNNEL',
      aggregation: 'SUM',
      valueFieldKey: 'amount',
    },
    {
      id: 'trend',
      type: 'TREND',
      title: '成交趋势',
      audience: 'TENANT_ADMIN',
      objectCode: 'opportunity',
      width: 'HALF',
      sortOrder: 30,
      filters: [],
      dateFieldKey: 'close_at',
      granularity: 'MONTH',
      aggregation: 'COUNT',
    },
    {
      id: 'leaderboard',
      type: 'LEADERBOARD',
      title: '负责人排行',
      audience: 'TENANT_ADMIN',
      objectCode: 'opportunity',
      width: 'HALF',
      sortOrder: 40,
      filters: [],
      memberSource: 'FIELD',
      memberFieldKey: 'owner',
      aggregation: 'COUNT',
      limit: 10,
    },
    {
      id: 'records',
      type: 'RECORD_LIST',
      title: '最近更新',
      audience: 'ALL',
      objectCode: 'opportunity',
      width: 'FULL',
      sortOrder: 50,
      filters: [],
      fieldKeys: ['name', 'stage', 'amount'],
      sort: { field: 'updatedAt', direction: 'DESC' },
      limit: 8,
    },
  ],
} as const;

describe('dashboard definition v2', () => {
  it('parses one structurally valid widget of every supported type', () => {
    const parsed = parseDashboardDraft(completeDraft);

    expect(parsed.widgets.map((widget) => widget.type)).toEqual([
      'METRIC',
      'STATUS_DISTRIBUTION',
      'TREND',
      'LEADERBOARD',
      'RECORD_LIST',
    ]);
  });

  it('rejects duplicate widget IDs', () => {
    expect(() =>
      parseDashboardDraft({
        ...completeDraft,
        widgets: [
          completeDraft.widgets[0],
          { ...completeDraft.widgets[1], id: 'metric-total' },
        ],
      }),
    ).toThrow('Invalid dashboard definition');
  });

  it('rejects a definition containing more than 24 widgets', () => {
    expect(() =>
      parseDashboardDraft({
        ...completeDraft,
        widgets: Array.from({ length: 25 }, (_, index) => ({
          ...completeDraft.widgets[0],
          id: `metric-${index}`,
        })),
      }),
    ).toThrow('Invalid dashboard definition');
  });

  it('parses an incomplete record-list draft and reports its empty field selection semantically', () => {
    const draft = parseDashboardDraft({
      ...completeDraft,
      widgets: [{ ...completeDraft.widgets[4], fieldKeys: [] }],
    });

    expect(draft.widgets[0]).toEqual(
      expect.objectContaining({ type: 'RECORD_LIST', fieldKeys: [] }),
    );
    expect(validateDashboardDraft(draft, [opportunity])).toContainEqual(
      expect.objectContaining({
        code: 'RECORD_LIST_FIELDS_REQUIRED',
        path: 'widgets[0].fieldKeys',
      }),
    );
  });

  it('reports filters whose operator is incompatible with the referenced field', () => {
    const draft = parseDashboardDraft({
      ...completeDraft,
      widgets: [
        {
          ...completeDraft.widgets[0],
          filters: [{ fieldKey: 'stage', operator: 'GT', value: 'won' }],
        },
      ],
    });

    expect(validateDashboardDraft(draft, [opportunity])).toContainEqual(
      expect.objectContaining({
        code: 'FILTER_OPERATOR_INVALID',
        path: 'widgets[0].filters[0].operator',
      }),
    );
  });

  it.each([
    ['amount', 'EQ', 'ten'],
    ['amount', 'BETWEEN', [1, Number.POSITIVE_INFINITY]],
    ['amount', 'BETWEEN', [20, 10]],
    ['approved', 'EQ', 'true'],
    ['close_at', 'BETWEEN', ['2026-02-30', '2026-03-01']],
    ['close_at', 'BETWEEN', ['2026-03-02', '2026-03-01']],
    [
      'closed_at',
      'BETWEEN',
      ['2026-09-01T00:00:00', '2026-09-02T00:00:00.000Z'],
    ],
    [
      'closed_at',
      'BETWEEN',
      ['2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    ],
    ['close_at', 'PAST_N_DAYS', 0],
    ['close_at', 'NEXT_N_DAYS', 3661],
    ['stage', 'IN', []],
    ['stage', 'IN', ['']],
    ['name', 'CONTAINS', '   '],
  ] as const)(
    'reports a path-specific issue for invalid %s %s filter values',
    (fieldKey, operator, value) => {
      const draft = parseDashboardDraft({
        ...completeDraft,
        widgets: [
          {
            ...completeDraft.widgets[0],
            filters: [{ fieldKey, operator, value }],
          },
        ],
      });

      expect(validateDashboardDraft(draft, [opportunity])).toContainEqual(
        expect.objectContaining({
          code: 'FILTER_VALUE_INVALID',
          path: 'widgets[0].filters[0].value',
        }),
      );
    },
  );

  it.each([
    ['amount', 'EQ', 12.5],
    ['amount', 'BETWEEN', [1, 20]],
    ['approved', 'EQ', false],
    ['close_at', 'BETWEEN', ['2026-02-28', '2026-03-01']],
    [
      'closed_at',
      'BETWEEN',
      ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00.123Z'],
    ],
    ['close_at', 'PAST_N_DAYS', 14],
    ['stage', 'IN', ['new']],
    ['name', 'EQ', 'Acme'],
  ] as const)(
    'accepts a valid %s %s filter value',
    (fieldKey, operator, value) => {
      const draft = parseDashboardDraft({
        ...completeDraft,
        widgets: [
          {
            ...completeDraft.widgets[0],
            filters: [{ fieldKey, operator, value }],
          },
        ],
      });

      expect(validateDashboardDraft(draft, [opportunity])).toEqual([]);
    },
  );

  it('normalizes widget ordering and compiles object, field, and option display metadata', () => {
    const normalized = normalizeDashboardDraft(
      parseDashboardDraft(completeDraft),
    );
    const publication = compileDashboardPublication(normalized, [opportunity]);

    expect(publication.widgets.map((widget) => widget.id)).toEqual([
      'pipeline',
      'metric-total',
      'trend',
      'leaderboard',
      'records',
    ]);
    const pipeline = publication.widgets[0];
    expect(pipeline?.objectPublicationId).toBe('publication-opportunity-v7');
    if (pipeline?.type !== 'STATUS_DISTRIBUTION') {
      throw new Error('Status distribution missing');
    }
    expect(pipeline.groupByField).toMatchObject({
      fieldKey: 'stage',
      label: '阶段',
    });
    expect(pipeline.options).toContainEqual({
      key: 'won',
      label: '已成交',
      color: 'GREEN',
    });
  });

  it('normalizes away an unused COUNT value field before compilation', () => {
    const draft = parseDashboardDraft({
      ...completeDraft,
      widgets: [
        {
          ...completeDraft.widgets[0],
          valueFieldKey: 'field-that-does-not-exist',
        },
      ],
    });

    const normalized = normalizeDashboardDraft(draft);
    const publication = compileDashboardPublication(normalized, [opportunity]);

    expect(normalized.widgets[0]).not.toHaveProperty('valueFieldKey');
    expect(publication.widgets[0]).not.toHaveProperty('valueFieldKey');
    expect(publication.widgets[0]).not.toHaveProperty('valueField');
  });

  it('migrates a legacy opportunity configuration with stable IDs and is idempotent', () => {
    const legacy = {
      opportunity: {
        objectCode: 'opportunity',
        stageFieldKey: 'stage',
        amountFieldKey: 'amount',
        dateFieldKey: 'close_at',
        activeOptionKeys: ['new'],
        wonOptionKeys: ['won'],
        lostOptionKeys: ['lost'],
      },
    };

    const migrated = migrateLegacyDashboard(legacy);

    expect(migrated.widgets.map((widget) => widget.id)).toEqual([
      'legacy-opportunity-total',
      'legacy-opportunity-pipeline',
      'legacy-opportunity-trend',
      'legacy-opportunity-leaderboard',
      'legacy-opportunity-records',
    ]);
    expect(migrated.widgets).toContainEqual(
      expect.objectContaining({
        id: 'legacy-opportunity-records',
        filters: [
          {
            fieldKey: 'stage',
            operator: 'IN',
            value: ['new'],
          },
        ],
        fieldKeys: ['stage', 'amount'],
        sort: { field: 'close_at', direction: 'ASC' },
        limit: 10,
      }),
    );
    expect(migrateLegacyDashboard(migrated)).toEqual(migrated);
  });

  it('keeps the updated-at descending legacy record fallback when no date field exists', () => {
    const migrated = migrateLegacyDashboard({
      opportunity: {
        objectCode: 'opportunity',
        stageFieldKey: 'stage',
        activeOptionKeys: ['new'],
        wonOptionKeys: ['won'],
        lostOptionKeys: ['lost'],
      },
    });

    expect(migrated.widgets).toContainEqual(
      expect.objectContaining({
        id: 'legacy-opportunity-records',
        sort: { field: 'updatedAt', direction: 'DESC' },
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
