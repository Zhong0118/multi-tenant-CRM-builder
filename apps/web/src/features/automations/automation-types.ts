import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";

export type AutomationValue = string | number | boolean | string[] | null;
export type AutomationMapping =
  | { source: "SOURCE_FIELD"; fieldKey: string }
  | { source: "LITERAL"; value: AutomationValue }
  | { source: "NOW" }
  | { source: "INPUT" };
export interface AutomationRule {
  key: string;
  label: string;
  enabled: boolean;
  allowedRoles: ("TENANT_ADMIN" | "EMPLOYEE")[];
  trigger:
    | { type: "MANUAL" }
    | { type: "FIELD_CHANGED"; fieldKey: string; equals: AutomationValue };
  targetObjectCode: string;
  owner: "ACTOR" | "SOURCE_OWNER";
  mappings: Record<string, AutomationMapping>;
}
export interface AutomationConfiguration {
  objectId: string;
  version: number;
  rules: AutomationRule[];
  publishedRules: AutomationRule[];
}
export interface AutomationInputField {
  fieldKey: string;
  label: string;
  type: PublishedFieldView["type"];
  required: boolean;
  config: PublishedFieldView["config"];
  defaultValue: unknown;
  validation?: PublishedFieldView["validation"];
}
export interface RuntimeAutomation {
  key: string;
  label: string;
  targetObjectCode: string;
  targetObjectName: string;
  inputFields: AutomationInputField[];
}
export interface AutomationPreview {
  ruleKey: string;
  targetObjectCode: string;
  targetObjectName: string;
  values: Record<string, unknown>;
  fieldLabels?: Record<string, string>;
  ownerMemberId: string;
  sourceRecordId: string;
}
export interface AutomationExecution {
  id: string;
  ruleKey: string;
  ruleLabel: string;
  triggerType: "MANUAL" | "FIELD_CHANGED";
  sourceRecordId: string;
  targetObjectCode: string;
  targetRecordId: string;
  targetRecordNo: string;
  actorMemberId: string;
  executedAt: string;
  publicationId: string;
}
export interface AutomationTable {
  code: string;
  name: string;
  fields: AutomationInputField[];
}

export function editableAutomationField(
  field: AutomationInputField,
): PublishedFieldView {
  return {
    ...field,
    id: field.fieldKey,
    validation: field.validation ?? {},
    sortOrder: 0,
    isSystem: false,
    access: "EDIT",
  };
}

/** Display stored option keys using the same labels as the business form. */
export function automationValueLabel(
  value: unknown,
  field?: AutomationInputField,
): string {
  const options = field ? selectOptions(field) : [];
  const label = (item: unknown) =>
    typeof item === "boolean"
      ? item
        ? "是"
        : "否"
      : (options.find((option) => option.key === item)?.label ??
        String(item ?? "—"));
  return Array.isArray(value) ? value.map(label).join("、") : label(value);
}

export function automationTriggerLabel(
  rule: AutomationRule,
  fields: AutomationInputField[],
): string {
  const trigger = rule.trigger;
  if (trigger.type === "MANUAL") return "点击动作并确认后";
  const field = fields.find((item) => item.fieldKey === trigger.fieldKey);
  return `「${field?.label ?? trigger.fieldKey}」变为「${automationValueLabel(trigger.equals, field)}」时`;
}
