import type { PublishedWorkflow } from '../workflows/workflow.types';

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

export const SEARCHABLE_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'PHONE',
  'EMAIL',
] as const satisfies readonly PublishedFieldType[];

export type SearchableFieldType = (typeof SEARCHABLE_FIELD_TYPES)[number];

export function isSearchableFieldType(
  value: string,
): value is SearchableFieldType {
  return (SEARCHABLE_FIELD_TYPES as readonly string[]).includes(value);
}

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
    /**
     * Extra JSONB fields included in keyword search. Missing on older
     * publications means “search the visible default-view text columns”.
     * An empty array means title-only search.
     */
    searchFieldKeys?: string[];
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
  workflow?: PublishedWorkflow;
}

export function isPublishedFieldType(
  value: string,
): value is PublishedFieldType {
  return (PUBLISHED_FIELD_TYPES as readonly string[]).includes(value);
}
