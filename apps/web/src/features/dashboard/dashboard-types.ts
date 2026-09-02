import type { components } from "@crm/contracts";

export type DashboardWidgetType =
  "METRIC" | "STATUS_DISTRIBUTION" | "TREND" | "LEADERBOARD" | "RECORD_LIST";
export type DashboardAudience = "ALL" | "TENANT_ADMIN" | "EMPLOYEE";
export type DashboardWidgetWidth = "QUARTER" | "HALF" | "FULL";
export type DashboardFieldType =
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
export interface DashboardFilter {
  fieldKey: string;
  operator:
    | "IN"
    | "NOT_IN"
    | "EQ"
    | "GT"
    | "GTE"
    | "LT"
    | "LTE"
    | "BETWEEN"
    | "TODAY"
    | "THIS_WEEK"
    | "THIS_MONTH"
    | "PAST_N_DAYS"
    | "NEXT_N_DAYS"
    | "CURRENT_USER"
    | "RECORD_OWNER"
    | "CONTAINS"
    | "NOT_EMPTY";
  value?:
    string | number | boolean | string[] | [string | number, string | number];
}
interface Base {
  id: string;
  type: DashboardWidgetType;
  title: string;
  description?: string;
  audience: DashboardAudience;
  objectCode: string;
  width: DashboardWidgetWidth;
  sortOrder: number;
  filters: DashboardFilter[];
}
export type DashboardWidgetDraft =
  | (Base & {
      type: "METRIC";
      aggregation: "COUNT" | "SUM" | "AVG";
      valueFieldKey?: string;
      displayFormat?: "NUMBER" | "MONEY" | "PERCENT";
    })
  | (Base & {
      type: "STATUS_DISTRIBUTION";
      groupByFieldKey: string;
      optionKeys: string[];
      display: "FUNNEL" | "BAR" | "DONUT";
      aggregation: "COUNT" | "SUM";
      valueFieldKey?: string;
    })
  | (Base & {
      type: "TREND";
      dateFieldKey: string;
      granularity: "DAY" | "WEEK" | "MONTH" | "AUTO";
      aggregation: "COUNT" | "SUM";
      valueFieldKey?: string;
    })
  | (Base & {
      type: "LEADERBOARD";
      memberSource: "RECORD_OWNER" | "FIELD";
      memberFieldKey?: string;
      aggregation: "COUNT" | "SUM";
      valueFieldKey?: string;
      limit: number;
    })
  | (Base & {
      type: "RECORD_LIST";
      fieldKeys: string[];
      sort: { field: string; direction: "ASC" | "DESC" };
      limit: number;
    });
export interface DashboardDefinitionV2 {
  schemaVersion: 2;
  title: string;
  widgets: DashboardWidgetDraft[];
}
export interface DashboardCandidateOption {
  key: string;
  label: string;
  color: string;
  status: "ACTIVE" | "INACTIVE";
}
export interface DashboardCandidateField {
  fieldKey: string;
  label: string;
  type: DashboardFieldType | string;
  config: { options?: DashboardCandidateOption[] };
}
export interface DashboardCandidate {
  object: { code: string; name: string };
  fields: DashboardCandidateField[];
}
export interface DashboardListItem {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  audience: "ALL" | "TENANT_ADMIN" | "EMPLOYEE";
  sortOrder: number;
  hasPublishedVersion: boolean;
  isDefaultAdmin: boolean;
  isDefaultEmployee: boolean;
}
export interface DashboardDraft {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  audience: "ALL" | "TENANT_ADMIN" | "EMPLOYEE";
  sortOrder: number;
  draftVersion: number;
  draftConfiguration: DashboardDefinitionV2;
  activePublicationId: string | null;
  sourceTemplateVersionId: string | null;
  updatedAt: string;
}
export interface DashboardPublicationSummary {
  id: string;
  number: number;
  sourceDraftVersion: number;
  publishedAt: string;
}
export interface DashboardConfigurationIssue {
  code: string;
  path: string;
  message: string;
}
export interface DashboardConfigurationView {
  timezone: string;
  dashboards: DashboardListItem[];
  dashboard: DashboardListItem | null;
  draft: DashboardDraft | null;
  activePublication: DashboardPublicationSummary | null;
  candidates: DashboardCandidate[];
  issues: DashboardConfigurationIssue[];
}
export type DashboardRuntimeWidget =
  | {
      id: string;
      type: "METRIC";
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "READY";
      data: { value: number | null; format?: "NUMBER" | "MONEY" | "PERCENT" };
    }
  | {
      id: string;
      type: "STATUS_DISTRIBUTION";
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "READY";
      data: {
        display: "FUNNEL" | "BAR" | "DONUT";
        items: Array<{
          optionKey: string;
          label: string;
          color: string;
          value: number;
        }>;
      };
    }
  | {
      id: string;
      type: "TREND";
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "READY";
      data: { items: Array<{ date: string; value: number }> };
    }
  | {
      id: string;
      type: "LEADERBOARD";
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "READY";
      data: {
        items: Array<{ memberId: string; displayName: string; value: number }>;
      };
    }
  | {
      id: string;
      type: "RECORD_LIST";
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "READY";
      data: {
        fields: Array<{ fieldKey: string; label: string; type: string }>;
        items: Array<{
          id: string;
          recordNo: string;
          title: string;
          ownerMemberId: string | null;
          ownerName: string | null;
          updatedAt: string;
          values: Record<string, unknown>;
        }>;
      };
    }
  | {
      id: string;
      type: DashboardWidgetType;
      title: string;
      description?: string;
      objectCode: string;
      width: DashboardWidgetWidth;
      sortOrder: number;
      state: "UNAVAILABLE";
      reason?:
        | "AUDIENCE_EXCLUDED"
        | "OBJECT_UNAVAILABLE"
        | "OBJECT_ACCESS_DENIED"
        | "FIELD_HIDDEN"
        | "QUERY_FAILED";
    };

export interface DashboardRuntime {
  title: string;
  period: { from: string; to: string; timezone: string };
  widgets: DashboardRuntimeWidget[];
}

export interface DashboardRuntimeResult extends DashboardRuntime {
  state: "READY" | "UNCONFIGURED";
  role: "TENANT_ADMIN" | "EMPLOYEE";
  publication?: DashboardPublicationSummary;
}

export function parseDashboardConfigurationView(
  value: components["schemas"]["DashboardConfigurationEnvelopeDto"],
): DashboardConfigurationView {
  const root = object(value);
  return {
    timezone: text(root.timezone),
    dashboards: array(root.dashboards ?? []).map(parseDashboardListItem),
    dashboard:
      root.dashboard == null ? null : parseDashboardListItem(root.dashboard),
    draft: root.draft == null ? null : parseDraft(root.draft),
    activePublication:
      root.activePublication == null
        ? null
        : parsePublication(root.activePublication),
    candidates: array(root.candidates).map(parseCandidate),
    issues: array(root.issues).map(parseIssue),
  };
}
export function parseDraft(value: unknown): DashboardDraft {
  const root = object(value);
  return {
    id: text(root.id),
    code: text(root.code),
    name: text(root.name),
    status: one(root.status, ["ACTIVE", "ARCHIVED"] as const),
    audience: one(root.audience, ["ALL", "TENANT_ADMIN", "EMPLOYEE"] as const),
    sortOrder: num(root.sortOrder),
    draftVersion: num(root.draftVersion),
    draftConfiguration: definition(root.draftConfiguration),
    activePublicationId: nullableText(root.activePublicationId),
    sourceTemplateVersionId: nullableText(root.sourceTemplateVersionId),
    updatedAt: text(root.updatedAt),
  };
}
function parseDashboardListItem(value: unknown): DashboardListItem {
  const root = object(value);
  return {
    id: text(root.id),
    code: text(root.code),
    name: text(root.name),
    status: one(root.status, ["ACTIVE", "ARCHIVED"] as const),
    audience: one(root.audience, ["ALL", "TENANT_ADMIN", "EMPLOYEE"] as const),
    sortOrder: num(root.sortOrder),
    hasPublishedVersion: Boolean(root.hasPublishedVersion),
    isDefaultAdmin: Boolean(root.isDefaultAdmin),
    isDefaultEmployee: Boolean(root.isDefaultEmployee),
  };
}
export function parsePublication(value: unknown): DashboardPublicationSummary {
  const root = object(value);
  return {
    id: text(root.id),
    number: num(root.number),
    sourceDraftVersion: num(root.sourceDraftVersion),
    publishedAt: text(root.publishedAt),
  };
}
function definition(value: unknown): DashboardDefinitionV2 {
  const root = object(value);
  if (root.schemaVersion !== 2) invalid();
  return {
    schemaVersion: 2,
    title: text(root.title),
    widgets: array(root.widgets).map(widget),
  };
}
export function parseDashboardRuntime(value: unknown): DashboardRuntime {
  const root = object(value);
  const period = object(root.period);
  return {
    title: text(root.title),
    period: {
      from: text(period.from),
      to: text(period.to),
      timezone: text(period.timezone),
    },
    widgets: array(root.widgets).map(parseRuntimeWidget),
  };
}

export function parseDashboardOverview(value: unknown): DashboardRuntimeResult {
  const root = object(value);
  const runtime = parseDashboardRuntime(value);
  return {
    ...runtime,
    state: one(root.state, ["READY", "UNCONFIGURED"] as const),
    role: one(root.role, ["TENANT_ADMIN", "EMPLOYEE"] as const),
    ...(root.publication === undefined
      ? {}
      : { publication: parsePublication(root.publication) }),
  };
}

function widget(value: unknown): DashboardWidgetDraft {
  const root = object(value);
  const base = {
    id: text(root.id),
    title: text(root.title),
    audience: one(root.audience, ["ALL", "TENANT_ADMIN", "EMPLOYEE"] as const),
    objectCode: text(root.objectCode),
    width: one(root.width, ["QUARTER", "HALF", "FULL"] as const),
    sortOrder: num(root.sortOrder),
    filters: array(root.filters).map(parseDashboardFilter),
    ...(typeof root.description === "string"
      ? { description: root.description }
      : {}),
  };
  switch (root.type) {
    case "METRIC":
      return {
        ...base,
        type: "METRIC",
        aggregation: one(root.aggregation, ["COUNT", "SUM", "AVG"] as const),
        ...(typeof root.valueFieldKey === "string"
          ? { valueFieldKey: root.valueFieldKey }
          : {}),
        ...(root.displayFormat
          ? {
              displayFormat: one(root.displayFormat, [
                "NUMBER",
                "MONEY",
                "PERCENT",
              ] as const),
            }
          : {}),
      };
    case "STATUS_DISTRIBUTION":
      return {
        ...base,
        type: "STATUS_DISTRIBUTION",
        groupByFieldKey: text(root.groupByFieldKey),
        optionKeys: strings(root.optionKeys),
        display: one(root.display, ["FUNNEL", "BAR", "DONUT"] as const),
        aggregation: one(root.aggregation, ["COUNT", "SUM"] as const),
        ...(typeof root.valueFieldKey === "string"
          ? { valueFieldKey: root.valueFieldKey }
          : {}),
      };
    case "TREND":
      return {
        ...base,
        type: "TREND",
        dateFieldKey: text(root.dateFieldKey),
        granularity: one(root.granularity, [
          "DAY",
          "WEEK",
          "MONTH",
          "AUTO",
        ] as const),
        aggregation: one(root.aggregation, ["COUNT", "SUM"] as const),
        ...(typeof root.valueFieldKey === "string"
          ? { valueFieldKey: root.valueFieldKey }
          : {}),
      };
    case "LEADERBOARD":
      return {
        ...base,
        type: "LEADERBOARD",
        memberSource: one(root.memberSource, [
          "RECORD_OWNER",
          "FIELD",
        ] as const),
        aggregation: one(root.aggregation, ["COUNT", "SUM"] as const),
        limit: num(root.limit),
        ...(typeof root.memberFieldKey === "string"
          ? { memberFieldKey: root.memberFieldKey }
          : {}),
        ...(typeof root.valueFieldKey === "string"
          ? { valueFieldKey: root.valueFieldKey }
          : {}),
      };
    case "RECORD_LIST": {
      const sort = object(root.sort);
      return {
        ...base,
        type: "RECORD_LIST",
        fieldKeys: strings(root.fieldKeys),
        sort: {
          field: text(sort.field),
          direction: one(sort.direction, ["ASC", "DESC"] as const),
        },
        limit: num(root.limit),
      };
    }
    default:
      return invalid();
  }
}
export function parseDashboardFilter(value: unknown): DashboardFilter {
  const root = object(value);
  const operator = one(root.operator, [
    "IN",
    "NOT_IN",
    "EQ",
    "GT",
    "GTE",
    "LT",
    "LTE",
    "BETWEEN",
    "TODAY",
    "THIS_WEEK",
    "THIS_MONTH",
    "PAST_N_DAYS",
    "NEXT_N_DAYS",
    "CURRENT_USER",
    "RECORD_OWNER",
    "CONTAINS",
    "NOT_EMPTY",
  ] as const);
  const filter: DashboardFilter = { fieldKey: text(root.fieldKey), operator };
  if (root.value !== undefined) filter.value = filterValue(root.value);
  validateFilterValueShape(filter);
  return filter;
}
function filterValue(value: unknown): DashboardFilter["value"] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  )
    return value as [string | number, string | number];
  return invalid();
}
function validateFilterValueShape(filter: DashboardFilter) {
  const hasValue = filter.value !== undefined;
  if (
    [
      "TODAY",
      "THIS_WEEK",
      "THIS_MONTH",
      "CURRENT_USER",
      "RECORD_OWNER",
      "NOT_EMPTY",
    ].includes(filter.operator)
  ) {
    if (hasValue) invalid();
    return;
  }
  if (filter.operator === "IN" || filter.operator === "NOT_IN") {
    if (
      !Array.isArray(filter.value) ||
      filter.value.some((value) => typeof value !== "string")
    )
      invalid();
    return;
  }
  if (filter.operator === "PAST_N_DAYS" || filter.operator === "NEXT_N_DAYS") {
    if (typeof filter.value !== "number") invalid();
    return;
  }
  if (filter.operator === "BETWEEN") {
    if (
      !Array.isArray(filter.value) ||
      filter.value.length !== 2 ||
      filter.value.some(
        (value) => typeof value !== "string" && typeof value !== "number",
      )
    )
      invalid();
    return;
  }
  if (
    !hasValue ||
    (typeof filter.value !== "string" &&
      typeof filter.value !== "number" &&
      typeof filter.value !== "boolean")
  )
    invalid();
}
function parseRuntimeWidget(value: unknown): DashboardRuntimeWidget {
  const root = object(value);
  const base = {
    id: text(root.id),
    title: text(root.title),
    objectCode: text(root.objectCode),
    width: one(root.width, ["QUARTER", "HALF", "FULL"] as const),
    sortOrder: num(root.sortOrder),
    ...(typeof root.description === "string"
      ? { description: root.description }
      : {}),
  };
  const type = one(root.type, [
    "METRIC",
    "STATUS_DISTRIBUTION",
    "TREND",
    "LEADERBOARD",
    "RECORD_LIST",
  ] as const);
  const state = one(root.state, ["READY", "UNAVAILABLE"] as const);
  if (state === "UNAVAILABLE") {
    const unavailable: Extract<
      DashboardRuntimeWidget,
      { state: "UNAVAILABLE" }
    > = {
      ...base,
      type,
      state,
    };
    if (root.reason !== undefined) {
      unavailable.reason = one(root.reason, [
        "AUDIENCE_EXCLUDED",
        "OBJECT_UNAVAILABLE",
        "OBJECT_ACCESS_DENIED",
        "FIELD_HIDDEN",
        "QUERY_FAILED",
      ] as const);
    }
    return unavailable;
  }
  const data = object(root.data);
  if (type === "METRIC") {
    return {
      ...base,
      type,
      state,
      data: {
        value: data.value === null ? null : num(data.value),
        ...(data.format === undefined
          ? {}
          : {
              format: one(data.format, ["NUMBER", "MONEY", "PERCENT"] as const),
            }),
      },
    };
  }
  if (type === "STATUS_DISTRIBUTION") {
    return {
      ...base,
      type,
      state,
      data: {
        display: one(data.display, ["FUNNEL", "BAR", "DONUT"] as const),
        items: array(data.items).map((item) => {
          const point = object(item);
          return {
            optionKey: text(point.optionKey),
            label: text(point.label),
            color: text(point.color),
            value: num(point.value),
          };
        }),
      },
    };
  }
  if (type === "TREND") {
    return {
      ...base,
      type,
      state,
      data: {
        items: array(data.items).map((item) => {
          const point = object(item);
          return { date: text(point.date), value: num(point.value) };
        }),
      },
    };
  }
  if (type === "LEADERBOARD") {
    return {
      ...base,
      type,
      state,
      data: {
        items: array(data.items).map((item) => {
          const row = object(item);
          return {
            memberId: text(row.memberId),
            displayName: text(row.displayName),
            value: num(row.value),
          };
        }),
      },
    };
  }
  return {
    ...base,
    type,
    state,
    data: {
      fields: array(data.fields).map((item) => {
        const field = object(item);
        return {
          fieldKey: text(field.fieldKey),
          label: text(field.label),
          type: text(field.type),
        };
      }),
      items: array(data.items).map((item) => {
        const row = object(item);
        return {
          id: text(row.id),
          recordNo: text(row.recordNo),
          title: text(row.title),
          ownerMemberId:
            row.ownerMemberId === null ? null : text(row.ownerMemberId),
          ownerName: row.ownerName === null ? null : text(row.ownerName),
          updatedAt: text(row.updatedAt),
          values: object(row.values),
        };
      }),
    },
  };
}
function parseCandidate(value: unknown): DashboardCandidate {
  const root = object(value);
  const candidateObject = object(root.object);
  return {
    object: {
      code: text(candidateObject.code),
      name: text(candidateObject.name),
    },
    fields: array(root.fields).map((item) => {
      const field = object(item);
      const config = object(field.config);
      return {
        fieldKey: text(field.fieldKey),
        label: text(field.label),
        type: one(field.type, [
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
        ] as const),
        config: {
          ...(Array.isArray(config.options)
            ? { options: config.options.map(option) }
            : {}),
        },
      };
    }),
  };
}
function option(value: unknown): DashboardCandidateOption {
  const root = object(value);
  return {
    key: text(root.key),
    label: text(root.label),
    color: typeof root.color === "string" ? root.color : "GRAY",
    status: root.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}
function parseIssue(value: unknown): DashboardConfigurationIssue {
  const root = object(value);
  return {
    code: text(root.code),
    path: text(root.path),
    message: text(root.message),
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) invalid();
  return value;
}
function nullableText(value: unknown): string | null {
  return value == null ? null : text(value);
}
function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  return value;
}
function strings(value: unknown): string[] {
  const values = array(value);
  if (values.some((item) => typeof item !== "string")) invalid();
  return values as string[];
}
function one<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid();
  return value as T;
}
function invalid(): never {
  throw new Error("Invalid dashboard response");
}
