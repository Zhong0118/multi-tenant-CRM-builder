import type { PublicationDraftField } from './object-publication.policy';
import type { JsonValue, PublishedDataScope } from './object-schema';
import type {
  ObjectDraft,
  ObjectPublicationSummary,
} from './objects.repository';

export interface ObjectDraftFieldResponse {
  id: string;
  fieldKey: string;
  label: string;
  type: PublicationDraftField['type'];
  required: boolean;
  defaultValue: JsonValue;
  validation: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
  sortOrder: number;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  /**
   * The type this field carries in the live publication, or null when it has
   * never been published. A published type can no longer change, so the
   * designer reads the lock from here instead of guessing.
   */
  publishedType: PublicationDraftField['type'] | null;
  employeeAccess: 'EDIT' | 'READ_ONLY' | 'HIDDEN';
}

export interface ObjectDraftResponse {
  object: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
    version: number;
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    publicationNumber: number | null;
    publishedAt: string | null;
    hasUnpublishedChanges: boolean;
    updatedAt: string | null;
  };
  fields: ObjectDraftFieldResponse[];
  defaultView: {
    name: string;
    columnFieldKeys: string[];
    searchFieldKeys?: string[];
    sort: {
      field: 'updatedAt' | 'createdAt' | 'recordNo';
      direction: 'asc' | 'desc';
    };
  } | null;
  employeeAccess: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: PublishedDataScope;
    updateScope: PublishedDataScope;
  } | null;
  activeRecordCount: number;
}

export interface ObjectPublicationResponse {
  id: string;
  number: number;
  sourceDraftVersion: number;
  publishedAt: string;
  changes: Array<{
    kind: 'ADDED' | 'UPDATED' | 'INACTIVATED';
    fieldKey: string;
  }>;
}

/**
 * Projects an object draft for the designer. Reading the published
 * configuration stays an API responsibility: the response carries derived
 * facts — current publication number, whether the draft has moved on, and the
 * published type of each field — rather than the raw snapshot for the browser
 * to interpret.
 */
export function toObjectDraftResponse(draft: ObjectDraft): ObjectDraftResponse {
  const active = draft.activeSchema;
  const publishedTypes = new Map(
    (active?.fields ?? []).map((field) => [field.fieldKey, field.type]),
  );
  const fieldAccess = draft.employeeAccess?.fields ?? {};

  return {
    object: {
      id: draft.object.id,
      code: draft.object.code,
      name: draft.object.name,
      description: draft.object.description,
      titleFieldKey: draft.object.titleFieldKey,
      icon: draft.object.icon,
      sortOrder: draft.object.sortOrder,
      version: draft.object.version,
      status: draft.object.status,
      publicationNumber: active?.publication.number ?? null,
      publishedAt: draft.object.publishedAt,
      hasUnpublishedChanges:
        active === null ||
        active.publication.sourceDraftVersion < draft.object.version,
      updatedAt: draft.object.updatedAt ?? null,
    },
    fields: [...draft.fields]
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.fieldKey.localeCompare(right.fieldKey),
      )
      .map((field) => ({
        id: field.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        required: field.required,
        defaultValue: field.defaultValue,
        validation: field.validation,
        config: field.config,
        sortOrder: field.sortOrder,
        isSystem: field.isSystem,
        status: field.status,
        publishedType: publishedTypes.get(field.fieldKey) ?? null,
        employeeAccess: fieldAccess[field.fieldKey] ?? 'EDIT',
      })),
    defaultView: draft.defaultView
      ? {
          name: draft.defaultView.name,
          columnFieldKeys: draft.defaultView.columnFieldKeys,
          ...(draft.defaultView.searchFieldKeys === undefined
            ? {}
            : { searchFieldKeys: draft.defaultView.searchFieldKeys }),
          sort: draft.defaultView.sort,
        }
      : null,
    employeeAccess: draft.employeeAccess
      ? {
          canCreate: draft.employeeAccess.canCreate,
          canRead: draft.employeeAccess.canRead,
          canUpdate: draft.employeeAccess.canUpdate,
          canDelete: false,
          readScope: draft.employeeAccess.readScope,
          updateScope: draft.employeeAccess.updateScope,
        }
      : null,
    activeRecordCount: draft.activeRecordCount,
  };
}

export function toObjectPublicationResponse(
  publication: ObjectPublicationSummary,
): ObjectPublicationResponse {
  return {
    id: publication.id,
    number: publication.number,
    sourceDraftVersion: publication.sourceDraftVersion,
    publishedAt: publication.publishedAt,
    changes: publication.changes,
  };
}
