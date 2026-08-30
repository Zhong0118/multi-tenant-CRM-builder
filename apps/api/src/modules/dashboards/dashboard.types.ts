import type { PublishedObjectSchema } from '../objects/object-schema';

export interface DashboardOpportunityConfiguration {
  objectCode: string;
  stageFieldKey: string;
  amountFieldKey?: string;
  dateFieldKey?: string;
  activeOptionKeys: string[];
  wonOptionKeys: string[];
  lostOptionKeys: string[];
}

export interface DashboardLeadConfiguration {
  objectCode: string;
  convertedOptionKeys?: string[];
}

export interface DashboardActivityConfiguration {
  objectCode: string;
  dueAtFieldKey: string;
  statusFieldKey: string;
  completedOptionKeys: string[];
}

export interface DashboardConfiguration {
  opportunity: DashboardOpportunityConfiguration;
  lead?: DashboardLeadConfiguration;
  activity?: DashboardActivityConfiguration;
}

export interface DashboardConfigurationIssue {
  code: string;
  path: string;
  message: string;
}

export type DashboardPublishedObject = PublishedObjectSchema;

export interface DashboardConfigurationRecord {
  version: number;
  configuration: DashboardConfiguration;
  updatedAt: string;
}

export interface DashboardPeriod {
  from: string;
  to: string;
  timezone: string;
}

export interface DashboardOverviewQuery {
  from: Date;
  to: Date;
  timezone: string;
  ownerMemberId?: string;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number | null;
  format: 'COUNT' | 'MONEY' | 'PERCENT';
}

export interface DashboardPipelineItem {
  optionKey: string;
  label: string;
  color: string;
  count: number;
  amount: number;
}

export interface DashboardTrendItem {
  date: string;
  wonCount: number;
  wonAmount: number;
}

export interface DashboardAttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
}

export interface DashboardLeaderboardItem {
  memberId: string;
  displayName: string;
  wonCount: number;
  wonAmount: number;
  activeAmount: number;
}

export interface DashboardRecordItem {
  id: string;
  title: string;
  ownerMemberId: string | null;
  ownerName: string | null;
  stageKey: string | null;
  amount: number | null;
  dueAt: string | null;
  updatedAt: string;
}

export interface DashboardOverview {
  state: 'READY' | 'UNCONFIGURED' | 'NEEDS_REPAIR' | 'UNAVAILABLE';
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  period: DashboardPeriod;
  configuration?: DashboardConfiguration;
  issues: DashboardConfigurationIssue[];
  metrics: DashboardMetric[];
  pipeline: DashboardPipelineItem[];
  trend: DashboardTrendItem[];
  attention: DashboardAttentionItem[];
  leaderboard: DashboardLeaderboardItem[];
  records: DashboardRecordItem[];
}

export interface DashboardAggregateInput {
  configuration: DashboardConfiguration;
  opportunity: DashboardPublishedObject;
  period: DashboardPeriod;
  ownerMemberId?: string;
  includeLeaderboard: boolean;
}

export type DashboardAggregateResult = Omit<
  DashboardOverview,
  'state' | 'role' | 'period' | 'configuration' | 'issues'
>;
