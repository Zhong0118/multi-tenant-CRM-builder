import type {
  FieldConfigView,
  FieldValidationView,
  PublishedDataScope,
  PublishedFieldAccess,
  PublishedFieldType,
  RecordSortDirection,
  RecordSortField,
} from "./object-types";

/**
 * Presentation-only field shape shared by the tenant and template designers.
 * Mutation versions, tenant identity and publication requests intentionally do
 * not cross this boundary.
 */
export interface ConfigurableFieldView {
  id: string;
  fieldKey: string;
  label: string;
  type: PublishedFieldType;
  required: boolean;
  defaultValue: unknown;
  validation: FieldValidationView;
  config: FieldConfigView;
  sortOrder: number;
  isSystem: boolean;
  status: "ACTIVE" | "INACTIVE";
  publishedFieldKey?: string | null;
  publishedType: PublishedFieldType | null;
  employeeAccess: PublishedFieldAccess;
}

export interface ConfigurableObjectView {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
    publishedCode?: string | null;
  };
  fields: ConfigurableFieldView[];
  defaultView: {
    name: string;
    columnFieldKeys: string[];
    searchFieldKeys?: string[];
    sort: { field: RecordSortField; direction: RecordSortDirection };
  } | null;
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
  } | null;
}
