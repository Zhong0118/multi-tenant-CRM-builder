export type AutomationValue = string | number | boolean | string[] | null;
export type AutomationMapping =
  | { source: 'SOURCE_FIELD'; fieldKey: string }
  | { source: 'LITERAL'; value: AutomationValue }
  | { source: 'NOW' }
  | { source: 'INPUT' };
export interface AutomationRule {
  key: string;
  label: string;
  enabled: boolean;
  allowedRoles: ('TENANT_ADMIN' | 'EMPLOYEE')[];
  trigger:
    | { type: 'MANUAL' }
    | { type: 'FIELD_CHANGED'; fieldKey: string; equals: AutomationValue };
  targetObjectCode: string;
  owner: 'ACTOR' | 'SOURCE_OWNER';
  mappings: Record<string, AutomationMapping>;
}
export interface AutomationExecution {
  id: string;
  ruleKey: string;
  ruleLabel: string;
  triggerType: 'MANUAL' | 'FIELD_CHANGED';
  sourceRecordId: string;
  targetObjectCode: string;
  targetRecordId: string;
  targetRecordNo: string;
  actorMemberId: string;
  executedAt: string;
  publicationId: string;
}
