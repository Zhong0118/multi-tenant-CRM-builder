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
