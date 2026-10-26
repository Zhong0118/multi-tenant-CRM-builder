import type { WorkflowDraft } from '../workflows/workflow.types';
import type { AutomationRule } from '../automations/automation.types';
import type { PoolConfig } from '../records/record-ownership';
import type { GoalMetric } from '../work/dto/work-goals.dto';
import type {
  JsonValue,
  PublishedDataScope,
  PublishedFieldAccess,
  PublishedFieldType,
} from '../objects/object-schema';
import type { DashboardDefinitionV2 } from '../dashboards/dashboard.types';

export interface TemplateFieldConfiguration {
  id: string;
  fieldKey: string;
  label: string;
  type: PublishedFieldType;
  required: boolean;
  defaultValue: JsonValue;
  validation: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
  sortOrder: number;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface TemplateDefaultView {
  code: 'default';
  name: string;
  columnFieldKeys: string[];
  searchFieldKeys?: string[];
  sort: {
    field: 'updatedAt' | 'createdAt' | 'recordNo';
    direction: 'asc' | 'desc';
  };
}

export interface TemplateEmployeeAccess {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: false;
  readScope: PublishedDataScope;
  updateScope: PublishedDataScope;
  fields: Record<string, PublishedFieldAccess>;
}

export interface TemplateObjectConfiguration {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  titleFieldKey: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  fields: TemplateFieldConfiguration[];
  defaultView: TemplateDefaultView | null;
  employeeAccess: TemplateEmployeeAccess | null;
  workflow?: WorkflowDraft;
  automations?: AutomationRule[];
  pool?: Omit<PoolConfig, 'version'>;
}

export interface TemplateGoalRule {
  metric: GoalMetric;
  target: number;
  remindAt: string;
  weekdays: number[];
  audience: 'ALL_EMPLOYEES';
  enabled: boolean;
}

export interface BusinessTemplateConfiguration {
  schemaVersion: 1;
  objects: TemplateObjectConfiguration[];
  dashboard?: DashboardDefinitionV2;
  goalRules?: TemplateGoalRule[];
}
