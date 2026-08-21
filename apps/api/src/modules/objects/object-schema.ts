export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const PUBLISHED_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'PHONE',
  'EMAIL',
  'NUMBER',
  'MONEY',
  'DATE',
  'DATETIME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'MEMBER',
  'BOOLEAN',
] as const;

export type PublishedFieldType = (typeof PUBLISHED_FIELD_TYPES)[number];
export type PublishedFieldAccess = 'EDIT' | 'READ_ONLY' | 'HIDDEN';
export type PublishedDataScope = 'ALL' | 'OWN' | 'NONE';

export interface PublishedField {
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
}

export interface PublishedObjectSchema {
  publication: {
    id: string;
    number: number;
    sourceDraftVersion: number;
    publishedAt: string;
  };
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: PublishedField[];
  defaultView: {
    code: 'default';
    name: string;
    columnFieldKeys: string[];
    sort: {
      field: 'updatedAt' | 'createdAt' | 'recordNo';
      direction: 'asc' | 'desc';
    };
  };
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
    fields: Record<string, PublishedFieldAccess>;
  };
}

export function isPublishedFieldType(
  value: string,
): value is PublishedFieldType {
  return (PUBLISHED_FIELD_TYPES as readonly string[]).includes(value);
}
