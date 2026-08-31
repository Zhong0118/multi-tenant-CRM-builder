import type {
  DashboardAggregation,
  DashboardCatalog,
  DashboardConfigurationIssue,
  DashboardDefinitionV2,
  DashboardFilter,
  DashboardFilterOperator,
  DashboardMetricWidgetDraft,
  DashboardPublishedField,
  DashboardPublishedObject,
  DashboardPublishedOption,
  DashboardRecordListWidgetDraft,
  DashboardStatusDistributionWidgetDraft,
  DashboardTrendWidgetDraft,
  DashboardLeaderboardWidgetDraft,
  DashboardWidgetBase,
  DashboardWidgetDraft,
  PublishedDashboardDefinitionV2,
  PublishedDashboardWidgetV2,
} from './dashboard.types';

const MAX_WIDGETS = 24;
const FILTER_OPERATORS = new Set<DashboardFilterOperator>([
  'IN',
  'NOT_IN',
  'EQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'BETWEEN',
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'PAST_N_DAYS',
  'NEXT_N_DAYS',
  'CURRENT_USER',
  'RECORD_OWNER',
  'CONTAINS',
  'NOT_EMPTY',
]);
const NUMERIC_FIELD_TYPES = new Set(['NUMBER', 'MONEY']);
const DATE_FIELD_TYPES = new Set(['DATE', 'DATETIME']);
const TEXT_FIELD_TYPES = new Set(['TEXT', 'TEXTAREA', 'PHONE', 'EMAIL']);

export function parseDashboardDraft(value: unknown): DashboardDefinitionV2 {
  try {
    const root = exactObject(value, ['schemaVersion', 'title', 'widgets']);
    if (root.schemaVersion !== 2) invalid();
    const widgets = array(root.widgets).map(parseWidget);
    if (widgets.length > MAX_WIDGETS) invalid();
    if (new Set(widgets.map((widget) => widget.id)).size !== widgets.length) {
      invalid();
    }
    return { schemaVersion: 2, title: text(root.title), widgets };
  } catch {
    throw new Error('Invalid dashboard definition');
  }
}

export function normalizeDashboardDraft(
  value: DashboardDefinitionV2,
): DashboardDefinitionV2 {
  const parsed = parseDashboardDraft(value);
  return {
    ...parsed,
    widgets: parsed.widgets
      .map((widget, index) => ({ widget, index }))
      .sort((left, right) =>
        left.widget.sortOrder === right.widget.sortOrder
          ? left.index - right.index
          : left.widget.sortOrder - right.widget.sortOrder,
      )
      .map(({ widget }, index) => ({
        ...normalizeWidget(widget),
        sortOrder: index,
      })),
  } as DashboardDefinitionV2;
}

export function migrateLegacyDashboard(value: unknown): DashboardDefinitionV2 {
  if (isV2(value)) return normalizeDashboardDraft(parseDashboardDraft(value));

  const root = exactObject(value, ['opportunity', 'lead', 'activity']);
  const legacy = exactObject(root.opportunity, [
    'objectCode',
    'stageFieldKey',
    'amountFieldKey',
    'dateFieldKey',
    'activeOptionKeys',
    'wonOptionKeys',
    'lostOptionKeys',
  ]);
  const objectCode = text(legacy.objectCode);
  const stageFieldKey = text(legacy.stageFieldKey);
  const amountFieldKey = optionalText(legacy.amountFieldKey);
  const dateFieldKey = optionalText(legacy.dateFieldKey);
  const activeOptionKeys = textArray(legacy.activeOptionKeys);
  const wonOptionKeys = textArray(legacy.wonOptionKeys);
  const lostOptionKeys = textArray(legacy.lostOptionKeys);
  const wonFilter = wonOptionKeys.length
    ? [
        {
          fieldKey: stageFieldKey,
          operator: 'IN' as const,
          value: wonOptionKeys,
        },
      ]
    : [];
  const activeFilter = activeOptionKeys.length
    ? [
        {
          fieldKey: stageFieldKey,
          operator: 'IN' as const,
          value: activeOptionKeys,
        },
      ]
    : [];

  return normalizeDashboardDraft({
    schemaVersion: 2,
    title: '工作台',
    widgets: [
      {
        ...legacyBase('legacy-opportunity-total', '商机总数', objectCode, 0),
        type: 'METRIC',
        aggregation: 'COUNT',
        displayFormat: 'NUMBER',
      },
      {
        ...legacyBase('legacy-opportunity-pipeline', '商机漏斗', objectCode, 1),
        type: 'STATUS_DISTRIBUTION',
        groupByFieldKey: stageFieldKey,
        optionKeys: unique([
          ...activeOptionKeys,
          ...wonOptionKeys,
          ...lostOptionKeys,
        ]),
        display: 'FUNNEL',
        aggregation: amountFieldKey ? 'SUM' : 'COUNT',
        ...(amountFieldKey ? { valueFieldKey: amountFieldKey } : {}),
      },
      {
        ...legacyBase('legacy-opportunity-trend', '成交趋势', objectCode, 2),
        type: 'TREND',
        dateFieldKey: dateFieldKey ?? '',
        granularity: 'MONTH',
        aggregation: amountFieldKey ? 'SUM' : 'COUNT',
        ...(amountFieldKey ? { valueFieldKey: amountFieldKey } : {}),
        filters: wonFilter,
      },
      {
        ...legacyBase(
          'legacy-opportunity-leaderboard',
          '业绩排行',
          objectCode,
          3,
        ),
        type: 'LEADERBOARD',
        memberSource: 'RECORD_OWNER',
        aggregation: amountFieldKey ? 'SUM' : 'COUNT',
        ...(amountFieldKey ? { valueFieldKey: amountFieldKey } : {}),
        limit: 10,
        filters: wonFilter,
      },
      {
        ...legacyBase('legacy-opportunity-records', '优先记录', objectCode, 4),
        type: 'RECORD_LIST',
        fieldKeys: unique([stageFieldKey, amountFieldKey].filter(isString)),
        filters: activeFilter,
        sort: dateFieldKey
          ? { field: dateFieldKey, direction: 'ASC' }
          : { field: 'updatedAt', direction: 'DESC' },
        limit: 10,
      },
    ],
  });
}

export function validateDashboardDraft(
  value: DashboardDefinitionV2,
  catalog: DashboardCatalog,
): DashboardConfigurationIssue[] {
  const issues: DashboardConfigurationIssue[] = [];
  for (const [widgetIndex, widget] of value.widgets.entries()) {
    const path = `widgets[${widgetIndex}]`;
    if (!widget.title.trim()) {
      issues.push(
        issue(
          'WIDGET_TITLE_REQUIRED',
          `${path}.title`,
          'Widget title is required.',
        ),
      );
    }
    if (!widget.objectCode.trim()) {
      issues.push(
        issue(
          'WIDGET_OBJECT_REQUIRED',
          `${path}.objectCode`,
          'Object is required.',
        ),
      );
      continue;
    }
    const object = catalog.find(
      (candidate) => candidate.object.code === widget.objectCode,
    );
    if (!object) {
      issues.push(
        issue(
          'WIDGET_OBJECT_NOT_FOUND',
          `${path}.objectCode`,
          'Object does not exist or is not published.',
        ),
      );
      continue;
    }
    validateFilters(widget.filters, object, `${path}.filters`, issues);
    validateWidget(widget, object, path, issues);
  }
  return issues;
}

export function compileDashboardPublication(
  value: DashboardDefinitionV2,
  catalog: DashboardCatalog,
): PublishedDashboardDefinitionV2 {
  const normalized = normalizeDashboardDraft(value);
  const issues = validateDashboardDraft(normalized, catalog);
  if (issues.length) {
    throw new Error(
      `Dashboard definition has semantic issues: ${issues.map((entry) => entry.path).join(', ')}`,
    );
  }
  return {
    schemaVersion: 2,
    title: normalized.title,
    widgets: normalized.widgets.map((widget) => {
      const object = catalog.find(
        (candidate) => candidate.object.code === widget.objectCode,
      )!;
      return compileWidget(widget, object);
    }),
  };
}

function parseWidget(value: unknown): DashboardWidgetDraft {
  const type = text(
    exactObject(value, [
      'id',
      'type',
      'title',
      'description',
      'audience',
      'objectCode',
      'width',
      'sortOrder',
      'filters',
      'aggregation',
      'valueFieldKey',
      'displayFormat',
      'groupByFieldKey',
      'optionKeys',
      'display',
      'dateFieldKey',
      'granularity',
      'memberSource',
      'memberFieldKey',
      'limit',
      'fieldKeys',
      'sort',
    ]).type,
  );
  switch (type) {
    case 'METRIC':
      return parseMetric(value);
    case 'STATUS_DISTRIBUTION':
      return parseDistribution(value);
    case 'TREND':
      return parseTrend(value);
    case 'LEADERBOARD':
      return parseLeaderboard(value);
    case 'RECORD_LIST':
      return parseRecordList(value);
    default:
      invalid();
  }
}

function parseMetric(value: unknown): DashboardMetricWidgetDraft {
  const root = exactObject(
    value,
    baseKeys.concat(['aggregation', 'valueFieldKey', 'displayFormat']),
  );
  return {
    ...parseBase(root, 'METRIC'),
    aggregation: enumValue(root.aggregation, ['COUNT', 'SUM', 'AVG']),
    ...(root.valueFieldKey === undefined
      ? {}
      : { valueFieldKey: text(root.valueFieldKey) }),
    ...(root.displayFormat === undefined
      ? {}
      : {
          displayFormat: enumValue(root.displayFormat, [
            'NUMBER',
            'MONEY',
            'PERCENT',
          ] as const),
        }),
  };
}

function parseDistribution(
  value: unknown,
): DashboardStatusDistributionWidgetDraft {
  const root = exactObject(
    value,
    baseKeys.concat([
      'groupByFieldKey',
      'optionKeys',
      'display',
      'aggregation',
      'valueFieldKey',
    ]),
  );
  return {
    ...parseBase(root, 'STATUS_DISTRIBUTION'),
    groupByFieldKey: text(root.groupByFieldKey),
    optionKeys: textArray(root.optionKeys),
    display: enumValue(root.display, ['FUNNEL', 'BAR', 'DONUT']),
    aggregation: enumValue(root.aggregation, ['COUNT', 'SUM']),
    ...(root.valueFieldKey === undefined
      ? {}
      : { valueFieldKey: text(root.valueFieldKey) }),
  };
}

function parseTrend(value: unknown): DashboardTrendWidgetDraft {
  const root = exactObject(
    value,
    baseKeys.concat([
      'dateFieldKey',
      'granularity',
      'aggregation',
      'valueFieldKey',
    ]),
  );
  return {
    ...parseBase(root, 'TREND'),
    dateFieldKey: text(root.dateFieldKey),
    granularity: enumValue(root.granularity, ['DAY', 'WEEK', 'MONTH', 'AUTO']),
    aggregation: enumValue(root.aggregation, ['COUNT', 'SUM']),
    ...(root.valueFieldKey === undefined
      ? {}
      : { valueFieldKey: text(root.valueFieldKey) }),
  };
}

function parseLeaderboard(value: unknown): DashboardLeaderboardWidgetDraft {
  const root = exactObject(
    value,
    baseKeys.concat([
      'memberSource',
      'memberFieldKey',
      'aggregation',
      'valueFieldKey',
      'limit',
    ]),
  );
  const memberSource = enumValue(root.memberSource, ['RECORD_OWNER', 'FIELD']);
  return {
    ...parseBase(root, 'LEADERBOARD'),
    memberSource,
    ...(root.memberFieldKey === undefined
      ? {}
      : { memberFieldKey: text(root.memberFieldKey) }),
    aggregation: enumValue(root.aggregation, ['COUNT', 'SUM']),
    ...(root.valueFieldKey === undefined
      ? {}
      : { valueFieldKey: text(root.valueFieldKey) }),
    limit: boundedInteger(root.limit, 1, 50),
  };
}

function parseRecordList(value: unknown): DashboardRecordListWidgetDraft {
  const root = exactObject(
    value,
    baseKeys.concat(['fieldKeys', 'sort', 'limit']),
  );
  const sort = exactObject(root.sort, ['field', 'direction']);
  const fieldKeys = textArray(root.fieldKeys);
  if (
    fieldKeys.length < 1 ||
    fieldKeys.length > 8 ||
    new Set(fieldKeys).size !== fieldKeys.length
  )
    invalid();
  return {
    ...parseBase(root, 'RECORD_LIST'),
    fieldKeys,
    sort: {
      field: text(sort.field),
      direction: parseSortDirection(sort.direction),
    },
    limit: boundedInteger(root.limit, 1, 20),
  };
}

const baseKeys = [
  'id',
  'type',
  'title',
  'description',
  'audience',
  'objectCode',
  'width',
  'sortOrder',
  'filters',
];

function parseBase<T extends DashboardWidgetBase['type']>(
  root: Record<string, unknown>,
  type: T,
): Omit<DashboardWidgetBase, 'type'> & { type: T } {
  return {
    id: text(root.id),
    type,
    title: text(root.title),
    ...(root.description === undefined
      ? {}
      : { description: text(root.description) }),
    audience: enumValue(root.audience, ['ALL', 'TENANT_ADMIN', 'EMPLOYEE']),
    objectCode: text(root.objectCode),
    width: enumValue(root.width, ['QUARTER', 'HALF', 'FULL']),
    sortOrder: integer(root.sortOrder),
    filters: array(root.filters).map(parseFilter),
  };
}

function parseFilter(value: unknown): DashboardFilter {
  const root = exactObject(value, ['fieldKey', 'operator', 'value']);
  const operator = enumValue(root.operator, [...FILTER_OPERATORS]);
  const filter: DashboardFilter = { fieldKey: text(root.fieldKey), operator };
  if (root.value !== undefined) filter.value = parseFilterValue(root.value);
  validateFilterValueShape(filter);
  return filter;
}

function validateFilters(
  filters: DashboardFilter[],
  object: DashboardPublishedObject,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  for (const [index, filter] of filters.entries()) {
    const filterPath = `${path}[${index}]`;
    const field = findField(object, filter.fieldKey);
    if (!field) {
      issues.push(
        issue(
          'FILTER_FIELD_NOT_FOUND',
          `${filterPath}.fieldKey`,
          'Filter field does not exist.',
        ),
      );
      continue;
    }
    if (!operatorsFor(field.type).has(filter.operator)) {
      issues.push(
        issue(
          'FILTER_OPERATOR_INVALID',
          `${filterPath}.operator`,
          'Filter operator is not compatible with the field type.',
        ),
      );
      continue;
    }
    if (
      (field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT') &&
      (filter.operator === 'IN' || filter.operator === 'NOT_IN') &&
      isStringArray(filter.value)
    ) {
      validateOptionKeys(filter.value, field, `${filterPath}.value`, issues);
    }
  }
}

function validateWidget(
  widget: DashboardWidgetDraft,
  object: DashboardPublishedObject,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  switch (widget.type) {
    case 'METRIC':
      validateAggregate(
        widget.aggregation,
        widget.valueFieldKey,
        object,
        path,
        issues,
      );
      break;
    case 'STATUS_DISTRIBUTION': {
      const group = validateField(
        widget.groupByFieldKey,
        object,
        `${path}.groupByFieldKey`,
        issues,
      );
      if (group && group.type !== 'SINGLE_SELECT')
        issues.push(
          issue(
            'GROUP_BY_FIELD_TYPE_INVALID',
            `${path}.groupByFieldKey`,
            'Distribution grouping field must be SINGLE_SELECT.',
          ),
        );
      if (group)
        validateOptionKeys(
          widget.optionKeys,
          group,
          `${path}.optionKeys`,
          issues,
        );
      validateAggregate(
        widget.aggregation,
        widget.valueFieldKey,
        object,
        path,
        issues,
      );
      break;
    }
    case 'TREND': {
      const date = validateField(
        widget.dateFieldKey,
        object,
        `${path}.dateFieldKey`,
        issues,
      );
      if (date && !DATE_FIELD_TYPES.has(date.type))
        issues.push(
          issue(
            'DATE_FIELD_TYPE_INVALID',
            `${path}.dateFieldKey`,
            'Trend date field must be DATE or DATETIME.',
          ),
        );
      validateAggregate(
        widget.aggregation,
        widget.valueFieldKey,
        object,
        path,
        issues,
      );
      break;
    }
    case 'LEADERBOARD':
      if (widget.memberSource === 'FIELD') {
        const member = validateField(
          widget.memberFieldKey ?? '',
          object,
          `${path}.memberFieldKey`,
          issues,
        );
        if (member && member.type !== 'MEMBER')
          issues.push(
            issue(
              'MEMBER_FIELD_TYPE_INVALID',
              `${path}.memberFieldKey`,
              'Leaderboard member field must be MEMBER.',
            ),
          );
      }
      validateAggregate(
        widget.aggregation,
        widget.valueFieldKey,
        object,
        path,
        issues,
      );
      break;
    case 'RECORD_LIST':
      for (const [index, fieldKey] of widget.fieldKeys.entries())
        validateField(fieldKey, object, `${path}.fieldKeys[${index}]`, issues);
      if (!['createdAt', 'updatedAt', 'recordNo'].includes(widget.sort.field))
        validateField(widget.sort.field, object, `${path}.sort.field`, issues);
      break;
  }
}

function validateAggregate(
  aggregation: DashboardAggregation,
  valueFieldKey: string | undefined,
  object: DashboardPublishedObject,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  if (aggregation === 'COUNT') return;
  const field = validateField(
    valueFieldKey ?? '',
    object,
    `${path}.valueFieldKey`,
    issues,
  );
  if (field && !NUMERIC_FIELD_TYPES.has(field.type))
    issues.push(
      issue(
        'VALUE_FIELD_TYPE_INVALID',
        `${path}.valueFieldKey`,
        'Aggregation field must be NUMBER or MONEY.',
      ),
    );
}

function validateField(
  fieldKey: string,
  object: DashboardPublishedObject,
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  const field = findField(object, fieldKey);
  if (!field)
    issues.push(
      issue('FIELD_NOT_FOUND', path, 'Referenced field does not exist.'),
    );
  return field;
}

function compileWidget(
  widget: DashboardWidgetDraft,
  object: DashboardPublishedObject,
): PublishedDashboardWidgetV2 {
  const result: PublishedDashboardWidgetV2 = {
    ...widget,
    objectPublicationId: object.publication.id,
    objectPublicationNumber: object.publication.number,
    objectName: object.object.name,
    filterFields: widget.filters.map((filter) =>
      publishedField(findField(object, filter.fieldKey)!),
    ),
  };
  if (
    'valueFieldKey' in widget &&
    widget.aggregation !== 'COUNT' &&
    widget.valueFieldKey
  )
    result.valueField = publishedField(
      findField(object, widget.valueFieldKey)!,
    );
  if (widget.type === 'STATUS_DISTRIBUTION') {
    result.groupByField = publishedField(
      findField(object, widget.groupByFieldKey)!,
    );
    result.options = widget.optionKeys.map((key) =>
      publishedOption(findField(object, widget.groupByFieldKey)!, key)!,
    );
  }
  if (widget.type === 'TREND')
    result.dateField = publishedField(findField(object, widget.dateFieldKey)!);
  if (
    widget.type === 'LEADERBOARD' &&
    widget.memberSource === 'FIELD' &&
    widget.memberFieldKey
  )
    result.memberField = publishedField(
      findField(object, widget.memberFieldKey)!,
    );
  if (widget.type === 'RECORD_LIST') {
    result.displayFields = widget.fieldKeys.map((key) =>
      publishedField(findField(object, key)!),
    );
    if (!['createdAt', 'updatedAt', 'recordNo'].includes(widget.sort.field))
      result.sortField = publishedField(findField(object, widget.sort.field)!);
  }
  return result;
}

function operatorsFor(type: string): ReadonlySet<DashboardFilterOperator> {
  if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT')
    return new Set(['IN', 'NOT_IN']);
  if (NUMERIC_FIELD_TYPES.has(type))
    return new Set(['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN']);
  if (DATE_FIELD_TYPES.has(type))
    return new Set([
      'TODAY',
      'THIS_WEEK',
      'THIS_MONTH',
      'PAST_N_DAYS',
      'NEXT_N_DAYS',
      'BETWEEN',
    ]);
  if (type === 'BOOLEAN') return new Set(['EQ']);
  if (type === 'MEMBER') return new Set(['IN', 'CURRENT_USER', 'RECORD_OWNER']);
  if (TEXT_FIELD_TYPES.has(type))
    return new Set(['EQ', 'CONTAINS', 'NOT_EMPTY']);
  return new Set();
}

function validateFilterValueShape(filter: DashboardFilter) {
  const hasValue = filter.value !== undefined;
  if (
    [
      'TODAY',
      'THIS_WEEK',
      'THIS_MONTH',
      'CURRENT_USER',
      'RECORD_OWNER',
      'NOT_EMPTY',
    ].includes(filter.operator)
  ) {
    if (hasValue) invalid();
    return;
  }
  if (filter.operator === 'IN' || filter.operator === 'NOT_IN') {
    if (
      !Array.isArray(filter.value) ||
      filter.value.some((value) => typeof value !== 'string')
    )
      invalid();
    return;
  }
  if (filter.operator === 'PAST_N_DAYS' || filter.operator === 'NEXT_N_DAYS') {
    if (!Number.isInteger(filter.value) || Number(filter.value) <= 0) invalid();
    return;
  }
  if (filter.operator === 'BETWEEN') {
    if (
      !Array.isArray(filter.value) ||
      filter.value.length !== 2 ||
      filter.value.some(
        (item) => typeof item !== 'string' && typeof item !== 'number',
      )
    )
      invalid();
    return;
  }
  if (!hasValue) invalid();
}

function findField(object: DashboardPublishedObject, fieldKey: string) {
  return object.fields.find((field) => field.fieldKey === fieldKey);
}

function validateOptionKeys(
  keys: readonly string[],
  field: DashboardPublishedObject['fields'][number],
  path: string,
  issues: DashboardConfigurationIssue[],
) {
  const active = new Set(
    options(field).flatMap((option) =>
      option.status === 'INACTIVE' ? [] : [option.key],
    ),
  );
  for (const key of keys)
    if (!active.has(key))
      issues.push(
        issue(
          'OPTION_NOT_FOUND',
          path,
          `Option ${key} does not exist or is inactive.`,
        ),
      );
}

function publishedField(
  field: DashboardPublishedObject['fields'][number],
): DashboardPublishedField {
  return { fieldKey: field.fieldKey, label: field.label, type: field.type };
}

function publishedOption(
  field: DashboardPublishedObject['fields'][number],
  key: string,
): DashboardPublishedOption | undefined {
  const option = options(field).find(
    (candidate) => candidate.key === key && candidate.status !== 'INACTIVE',
  );
  return option
    ? { key: option.key, label: option.label, color: option.color }
    : undefined;
}

function options(field: DashboardPublishedObject['fields'][number]) {
  const raw = field.config.options;
  if (!Array.isArray(raw))
    return [] as Array<{
      key: string;
      label: string;
      color: string;
      status?: string;
    }>;
  return raw.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.key !== 'string' ||
      typeof value.label !== 'string'
    )
      return [];
    return [
      {
        key: value.key,
        label: value.label,
        color: typeof value.color === 'string' ? value.color : 'GRAY',
        status: typeof value.status === 'string' ? value.status : undefined,
      },
    ];
  });
}

function legacyBase(
  id: string,
  title: string,
  objectCode: string,
  sortOrder: number,
): Omit<DashboardWidgetBase, 'type'> {
  return {
    id,
    title,
    audience: 'ALL',
    objectCode,
    width: 'HALF',
    sortOrder,
    filters: [],
  };
}

function normalizeWidget(widget: DashboardWidgetDraft): DashboardWidgetDraft {
  if (!('aggregation' in widget) || widget.aggregation !== 'COUNT') {
    return widget;
  }
  const { valueFieldKey: _unusedValueFieldKey, ...normalized } = widget;
  return normalized as DashboardWidgetDraft;
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}
function textArray(value: unknown): string[] {
  const values = array(value);
  if (values.some((entry) => typeof entry !== 'string')) invalid();
  return values as string[];
}
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}
function integer(value: unknown): number {
  if (!Number.isInteger(value)) invalid();
  return value as number;
}
function boundedInteger(value: unknown, min: number, max: number): number {
  const parsed = integer(value);
  if (parsed < min || parsed > max) invalid();
  return parsed;
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}
function parseSortDirection(value: unknown): 'ASC' | 'DESC' {
  if (value === 'ASC' || value === 'DESC') return value;
  if (value === 'asc') return 'ASC';
  if (value === 'desc') return 'DESC';
  invalid();
}
function parseFilterValue(value: unknown): DashboardFilter['value'] {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (
    Array.isArray(value) &&
    value.every(
      (entry) => typeof entry === 'string' || typeof entry === 'number',
    )
  )
    return value as DashboardFilter['value'];
  invalid();
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function isV2(value: unknown): value is DashboardDefinitionV2 {
  return isRecord(value) && value.schemaVersion === 2;
}
function issue(
  code: string,
  path: string,
  message: string,
): DashboardConfigurationIssue {
  return { code, path, message };
}
function invalid(): never {
  throw new Error('Invalid dashboard definition');
}
