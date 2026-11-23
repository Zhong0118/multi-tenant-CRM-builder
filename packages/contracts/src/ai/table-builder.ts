import type { TableEmployeePreset } from "./table-employee-presets.js";

export type BlueprintFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "PHONE"
  | "EMAIL"
  | "NUMBER"
  | "MONEY"
  | "DATE"
  | "DATETIME"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "MEMBER"
  | "BOOLEAN";
export interface FieldPlan {
  id: string;
  fieldKey: string;
  label: string;
  type: BlueprintFieldType;
  required: boolean;
  reason: string;
  options?: { id: string; key: string; label: string; reason: string }[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    scale?: number;
    country?: string;
  };
}
export interface TablePlan {
  id: string;
  code: string;
  name: string;
  description?: string;
  icon?: string;
  reason: string;
  fields: FieldPlan[];
  titleFieldId: string;
  view: { columnIds: string[]; reason: string };
  employeeIntent: {
    request: string;
    reason: string;
    recommendation?: TableEmployeePreset | null;
  }[];
}
export interface TableBlueprint {
  version: 1;
  tables: TablePlan[];
  assumptions: string[];
  omitted: {
    request: string;
    reason: string;
    alternative?: string;
    tableId?: string;
    manualField?: FieldPlan;
  }[];
}
export interface TableBuilderIssue {
  tableId?: string;
  fieldId?: string;
  path: string;
  code: string;
  message: string;
  blocking: boolean;
}
export interface TableBuilderTarget {
  objectId: string;
  expectedVersion: number;
}
export interface TableBuilderAnswer {
  key: "industry" | "entities";
  choiceId: string;
  otherText?: string;
}
export type TableBuilderResult =
  | {
      kind: "blueprint";
      blueprint: TableBlueprint;
      issues: TableBuilderIssue[];
    }
  | {
      kind: "question";
      key: TableBuilderAnswer["key"];
      prompt: string;
      options: { id: string; label: string }[];
    };
