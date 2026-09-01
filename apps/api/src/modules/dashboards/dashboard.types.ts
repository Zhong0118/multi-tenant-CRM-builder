import type { PublishedObjectSchema } from '../objects/object-schema';

export interface DashboardConfigurationIssue {
  code: string;
  path: string;
  message: string;
}

export type DashboardPublishedObject = PublishedObjectSchema;

export type DashboardWidgetType =
  'METRIC' | 'STATUS_DISTRIBUTION' | 'TREND' | 'LEADERBOARD' | 'RECORD_LIST';

export type DashboardAudience = 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';
export type DashboardWidgetWidth = 'QUARTER' | 'HALF' | 'FULL';
export type DashboardAggregation = 'COUNT' | 'SUM' | 'AVG';
export type DashboardDisplayFormat = 'NUMBER' | 'MONEY' | 'PERCENT';
export type DashboardFilterOperator =
  | 'IN'
  | 'NOT_IN'
  | 'EQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'BETWEEN'
  | 'TODAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'PAST_N_DAYS'
  | 'NEXT_N_DAYS'
  | 'CURRENT_USER'
  | 'RECORD_OWNER'
  | 'CONTAINS'
  | 'NOT_EMPTY';

export interface DashboardFilter {
  fieldKey: string;
  operator: DashboardFilterOperator;
  value?:
    string | number | boolean | string[] | [string | number, string | number];
}

export interface DashboardWidgetBase {
  id: string;
  type: DashboardWidgetType;
  title: string;
  description?: string;
  audience: DashboardAudience;
  objectCode: string;
  width: DashboardWidgetWidth;
  sortOrder: number;
  filters: DashboardFilter[];
}

export interface DashboardMetricWidgetDraft extends DashboardWidgetBase {
  type: 'METRIC';
  aggregation: DashboardAggregation;
  valueFieldKey?: string;
  displayFormat?: DashboardDisplayFormat;
}

export interface DashboardStatusDistributionWidgetDraft extends DashboardWidgetBase {
  type: 'STATUS_DISTRIBUTION';
  groupByFieldKey: string;
  optionKeys: string[];
  display: 'FUNNEL' | 'BAR' | 'DONUT';
  aggregation: 'COUNT' | 'SUM';
  valueFieldKey?: string;
}

export interface DashboardTrendWidgetDraft extends DashboardWidgetBase {
  type: 'TREND';
  dateFieldKey: string;
  granularity: 'DAY' | 'WEEK' | 'MONTH' | 'AUTO';
  aggregation: 'COUNT' | 'SUM';
  valueFieldKey?: string;
}

export interface DashboardLeaderboardWidgetDraft extends DashboardWidgetBase {
  type: 'LEADERBOARD';
  memberSource: 'RECORD_OWNER' | 'FIELD';
  memberFieldKey?: string;
  aggregation: 'COUNT' | 'SUM';
  valueFieldKey?: string;
  limit: number;
}

export interface DashboardRecordListWidgetDraft extends DashboardWidgetBase {
  type: 'RECORD_LIST';
  fieldKeys: string[];
  sort: {
    field: string;
    direction: 'ASC' | 'DESC';
  };
  limit: number;
}

export type DashboardWidgetDraft =
  | DashboardMetricWidgetDraft
  | DashboardStatusDistributionWidgetDraft
  | DashboardTrendWidgetDraft
  | DashboardLeaderboardWidgetDraft
  | DashboardRecordListWidgetDraft;

export interface DashboardDefinitionV2 {
  schemaVersion: 2;
  title: string;
  widgets: DashboardWidgetDraft[];
}

export type DashboardCatalog = readonly PublishedObjectSchema[];

export interface DashboardPublishedField {
  fieldKey: string;
  label: string;
  type: PublishedObjectSchema['fields'][number]['type'];
}

export interface DashboardPublishedOption {
  key: string;
  label: string;
  color: string;
}

export type PublishedDashboardWidgetV2 = DashboardWidgetDraft & {
  objectPublicationId: string;
  objectPublicationNumber: number;
  objectName: string;
  filterFields: DashboardPublishedField[];
  valueField?: DashboardPublishedField;
  groupByField?: DashboardPublishedField;
  dateField?: DashboardPublishedField;
  memberField?: DashboardPublishedField;
  displayFields?: DashboardPublishedField[];
  sortField?: DashboardPublishedField;
  options?: DashboardPublishedOption[];
};

export interface PublishedDashboardDefinitionV2 {
  schemaVersion: 2;
  title: string;
  widgets: PublishedDashboardWidgetV2[];
}

export type StoredDashboardPublicationConfiguration =
  { kind: 'LEGACY'; raw: unknown } | { kind: 'COMPILED_V2'; raw: unknown };

export type DashboardWidgetUnavailableReason =
  | 'AUDIENCE_EXCLUDED'
  | 'OBJECT_UNAVAILABLE'
  | 'OBJECT_ACCESS_DENIED'
  | 'FIELD_HIDDEN'
  | 'QUERY_FAILED';

interface DashboardWidgetResultBase {
  id: string;
  type: DashboardWidgetType;
  title: string;
  description?: string;
  objectCode?: string;
  width: DashboardWidgetWidth;
  sortOrder: number;
}

export interface DashboardMetricWidgetResult extends DashboardWidgetResultBase {
  type: 'METRIC';
  state: 'READY';
  data: {
    value: number | null;
    format?: DashboardDisplayFormat;
  };
}

export interface DashboardDistributionWidgetResult extends DashboardWidgetResultBase {
  type: 'STATUS_DISTRIBUTION';
  state: 'READY';
  data: {
    display: 'FUNNEL' | 'BAR' | 'DONUT';
    items: Array<{
      optionKey: string;
      label: string;
      color: string;
      value: number;
    }>;
  };
}

export interface DashboardTrendWidgetResult extends DashboardWidgetResultBase {
  type: 'TREND';
  state: 'READY';
  data: { items: Array<{ date: string; value: number }> };
}

export interface DashboardLeaderboardWidgetResult extends DashboardWidgetResultBase {
  type: 'LEADERBOARD';
  state: 'READY';
  data: {
    items: Array<{
      memberId: string;
      displayName: string;
      value: number;
    }>;
  };
}

export interface DashboardRecordListWidgetResult extends DashboardWidgetResultBase {
  type: 'RECORD_LIST';
  state: 'READY';
  data: {
    fields: DashboardPublishedField[];
    items: Array<{
      id: string;
      recordNo: string;
      title: string;
      ownerMemberId: string | null;
      ownerName: string | null;
      updatedAt: string;
      values: Record<string, unknown>;
    }>;
  };
}

export interface DashboardUnavailableWidgetResult extends DashboardWidgetResultBase {
  state: 'UNAVAILABLE';
  reason?: DashboardWidgetUnavailableReason;
}

export type DashboardWidgetResult =
  | DashboardMetricWidgetResult
  | DashboardDistributionWidgetResult
  | DashboardTrendWidgetResult
  | DashboardLeaderboardWidgetResult
  | DashboardRecordListWidgetResult
  | DashboardUnavailableWidgetResult;

export interface DashboardRuntimeResult {
  title: string;
  period: DashboardPeriod;
  widgets: DashboardWidgetResult[];
}

export interface DashboardPeriod {
  from: string;
  to: string;
  timezone: string;
}
