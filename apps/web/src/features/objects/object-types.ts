import type { components } from "@crm/contracts";

type Schemas = components["schemas"];

export type PublishedFieldType = Schemas["PublishedFieldResponseDto"]["type"];
export type PublishedFieldAccess = "EDIT" | "READ_ONLY" | "HIDDEN";
export type PublishedDataScope = "ALL" | "OWN" | "NONE";
export type RecordSortField = "updatedAt" | "createdAt" | "recordNo";
export type RecordSortDirection = "asc" | "desc";

export const PUBLISHED_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "MONEY",
  "DATE",
  "DATETIME",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "MEMBER",
  "BOOLEAN",
] as const satisfies readonly PublishedFieldType[];

/**
 * The generated contract types `publication`, `object`, `defaultView`,
 * `actions` and `scopes` as `{ [key: string]: unknown }` because the API
 * declares them as free-form objects. These views narrow that response once,
 * at the boundary, so no page has to re-interpret the runtime schema.
 */
export interface PublishedFieldView {
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
  access: PublishedFieldAccess;
}

export interface FieldValidationView {
  minLength?: number;
  maxLength?: number;
  country?: string;
  min?: number;
  max?: number;
  scale?: number;
}

export interface FieldConfigView {
  options?: SelectOptionConfig[];
  help?: string;
  placeholder?: string;
}

/** As stored in the published snapshot: a missing status means active. */
export interface SelectOptionConfig {
  key: string;
  label: string;
  status?: "ACTIVE" | "INACTIVE";
  color?: SelectOptionColor;
}

/** After normalization, every option states its status explicitly. */
export interface SelectOptionView {
  key: string;
  label: string;
  status: "ACTIVE" | "INACTIVE";
  color: SelectOptionColor;
}

export const SELECT_OPTION_COLORS = [
  "GRAY",
  "BLUE",
  "CYAN",
  "GREEN",
  "YELLOW",
  "ORANGE",
  "RED",
  "PURPLE",
] as const;

export type SelectOptionColor = (typeof SELECT_OPTION_COLORS)[number];

const DEFAULT_SELECT_OPTION_COLORS: readonly SelectOptionColor[] = [
  "BLUE",
  "GREEN",
  "ORANGE",
  "PURPLE",
  "CYAN",
  "YELLOW",
  "RED",
];

export function defaultSelectOptionColor(index: number): SelectOptionColor {
  return DEFAULT_SELECT_OPTION_COLORS[
    Math.abs(index) % DEFAULT_SELECT_OPTION_COLORS.length
  ]!;
}

export const SELECT_OPTION_COLOR_LABELS: Record<SelectOptionColor, string> = {
  GRAY: "灰色",
  BLUE: "蓝色",
  CYAN: "青色",
  GREEN: "绿色",
  YELLOW: "黄色",
  ORANGE: "橙色",
  RED: "红色",
  PURPLE: "紫色",
};

export interface RuntimeObjectSchema {
  publication: { number: number; publishedAt: string };
  object: {
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: PublishedFieldView[];
  defaultView: {
    code: string;
    name: string;
    columnFieldKeys: string[];
    sort: { field: RecordSortField; direction: RecordSortDirection };
  };
  actions: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  };
  scopes: { read: PublishedDataScope; update: PublishedDataScope };
}

export type RuntimeObjectNavigation =
  Schemas["RuntimeObjectNavigationResponseDto"];
export type RecordSummary = Schemas["RecordResponseDto"];
export type RecordPage = Schemas["RecordPageResponseDto"];

/**
 * Object configuration types. The API derives every fact the designer needs —
 * current publication number, whether the draft moved past the live version,
 * and the published type that locks a field — so these are read directly from
 * the generated contract without re-interpretation.
 */
export type ObjectDraft = Schemas["ObjectDraftResponseDto"];
export type ObjectDraftField = Schemas["ObjectDraftFieldResponseDto"];
export type ObjectDraftSummary = Schemas["ObjectDraftObjectResponseDto"];
export type ObjectPublication = Schemas["ObjectPublicationResponseDto"];
export type PublicationAnalysis = Schemas["PublicationAnalysisResponseDto"];
export type PublicationIssue = Schemas["PublicationIssueResponseDto"];
export type PublicationChange = Schemas["PublicationChangeResponseDto"];

export type CreateObjectInput = Schemas["CreateObjectDefinitionDto"];
export type UpdateObjectInput = Schemas["UpdateObjectDefinitionDto"];
export type CreateFieldInput = Schemas["CreateFieldDefinitionDto"];
export type UpdateFieldInput = Schemas["UpdateFieldDefinitionDto"];
export type DefaultViewInput = Schemas["DefaultViewDto"];
export type EmployeePermissionsInput = Schemas["EmployeePermissionsDto"];

/** Object codes and field keys are stable identifiers, not display text. */
export const OBJECT_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Title fields must render as a single readable line. */
export const TITLE_FIELD_TYPES = [
  "TEXT",
  "PHONE",
  "EMAIL",
  "SINGLE_SELECT",
] as const satisfies readonly PublishedFieldType[];

/**
 * Business-facing names for field types. Navigation and configuration copy use
 * these; `PublishedFieldType` stays the stable identifier.
 */
export const FIELD_TYPE_LABELS: Record<PublishedFieldType, string> = {
  TEXT: "文本",
  TEXTAREA: "长文本",
  PHONE: "电话",
  EMAIL: "邮箱",
  NUMBER: "数字",
  MONEY: "金额",
  DATE: "日期",
  DATETIME: "日期时间",
  SINGLE_SELECT: "单选",
  MULTI_SELECT: "多选",
  MEMBER: "成员",
  BOOLEAN: "是否",
};

export const FIELD_ACCESS_LABELS: Record<PublishedFieldAccess, string> = {
  EDIT: "可编辑",
  READ_ONLY: "只读",
  HIDDEN: "隐藏",
};

export const DATA_SCOPE_LABELS: Record<PublishedDataScope, string> = {
  ALL: "全部记录",
  OWN: "仅本人负责",
  NONE: "无权访问",
};

export const PUBLICATION_CHANGE_LABELS: Record<
  PublicationChange["kind"],
  string
> = {
  ADDED: "新增",
  UPDATED: "修改",
  INACTIVATED: "停用",
};

/**
 * A draft is either untouched since its last publication, carrying pending
 * edits, never published, or archived. Each state gets its own copy so the
 * list never implies a draft is live.
 */
export function objectStatusLabel(object: ObjectDraftSummary): string {
  if (object.status === "ARCHIVED") return "已归档";
  if (object.publicationNumber === null) return "草稿";
  return object.hasUnpublishedChanges ? "有未发布变更" : "已发布";
}

export function fieldTypeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type as PublishedFieldType] ?? type;
}

export function parseRuntimeObjectSchema(
  response: Schemas["PublishedObjectSchemaResponseDto"],
): RuntimeObjectSchema {
  const publication = asObject(response.publication, "publication");
  const object = asObject(response.object, "object");
  const defaultView = asObject(response.defaultView, "defaultView");
  const sort = asObject(defaultView.sort, "defaultView.sort");
  const actions = asObject(response.actions, "actions");
  const scopes = asObject(response.scopes, "scopes");

  const fields = response.fields.map(parseField);
  const fieldKeys = new Set(fields.map((field) => field.fieldKey));
  const titleFieldKey = asString(object.titleFieldKey, "object.titleFieldKey");
  const columnFieldKeys = asStringArray(
    defaultView.columnFieldKeys,
    "defaultView.columnFieldKeys",
  );
  for (const fieldKey of columnFieldKeys) {
    if (!fieldKeys.has(fieldKey)) {
      invalid(`defaultView.columnFieldKeys 引用了未发布字段 ${fieldKey}`);
    }
  }

  return {
    publication: {
      number: asInteger(publication.number, "publication.number"),
      publishedAt: asString(publication.publishedAt, "publication.publishedAt"),
    },
    object: {
      code: asString(object.code, "object.code"),
      name: asString(object.name, "object.name"),
      description: asNullableString(object.description, "object.description"),
      titleFieldKey,
      icon: asNullableString(object.icon, "object.icon"),
      sortOrder: asInteger(object.sortOrder, "object.sortOrder"),
    },
    fields,
    defaultView: {
      code: asString(defaultView.code, "defaultView.code"),
      name: asString(defaultView.name, "defaultView.name"),
      columnFieldKeys,
      sort: {
        field: asMember(
          sort.field,
          ["updatedAt", "createdAt", "recordNo"] as const,
          "defaultView.sort.field",
        ),
        direction: asMember(
          sort.direction,
          ["asc", "desc"] as const,
          "defaultView.sort.direction",
        ),
      },
    },
    actions: {
      canCreate: asBoolean(actions.canCreate, "actions.canCreate"),
      canRead: asBoolean(actions.canRead, "actions.canRead"),
      canUpdate: asBoolean(actions.canUpdate, "actions.canUpdate"),
      canDelete: asBoolean(actions.canDelete, "actions.canDelete"),
    },
    scopes: {
      read: asMember(scopes.read, SCOPES, "scopes.read"),
      update: asMember(scopes.update, SCOPES, "scopes.update"),
    },
  };
}

/**
 * Reads the published option list of a select field. A missing status means
 * the option is active; inactive options stay readable so historical values
 * keep their label, but callers must not offer them for new writes.
 */
export function selectOptions(
  field: Pick<PublishedFieldView, "config">,
): SelectOptionView[] {
  const options = field.config.options;
  if (!Array.isArray(options)) return [];

  return options.flatMap((option, index) => {
    if (!isRecord(option)) return [];
    const { key, label, status, color } = option as Record<string, unknown>;
    if (typeof key !== "string" || typeof label !== "string") return [];
    return [
      {
        key,
        label,
        status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        color: SELECT_OPTION_COLORS.includes(color as SelectOptionColor)
          ? (color as SelectOptionColor)
          : defaultSelectOptionColor(index),
      },
    ];
  });
}

const SCOPES = ["ALL", "OWN", "NONE"] as const;
const FIELD_ACCESS = ["EDIT", "READ_ONLY", "HIDDEN"] as const;

function parseField(
  field: Schemas["PublishedFieldResponseDto"],
): PublishedFieldView {
  return {
    id: field.id,
    fieldKey: field.fieldKey,
    label: field.label,
    type: asMember(field.type, PUBLISHED_FIELD_TYPES, "field.type"),
    required: field.required,
    defaultValue: field.defaultValue,
    validation: field.validation as FieldValidationView,
    config: field.config as FieldConfigView,
    sortOrder: field.sortOrder,
    isSystem: field.isSystem,
    access: asMember(field.access, FIELD_ACCESS, "field.access"),
  };
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path} 不是对象`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${path} 不是非空字符串`);
  }
  return value;
}

function asNullableString(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== "string") {
    invalid(`${path} 不是字符串或 null`);
  }
  return value;
}

function asInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalid(`${path} 不是整数`);
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(`${path} 不是布尔值`);
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(`${path} 不是字符串数组`);
  }
  return value as string[];
}

function asMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(`${path} 不是 ${allowed.join(" | ")}`);
  }
  return value as T;
}

function invalid(reason: string): never {
  throw new Error(`运行时对象 Schema 无效：${reason}`);
}
