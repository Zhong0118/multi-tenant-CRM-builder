import { legacyFiltersToRule, type FilterRule } from "@crm/contracts";
import {
  selectOptions,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { resolveRecordColumnKeys } from "./record-columns";
import { queryFields } from "./record-access";
import { readDisplayPrefs } from "./record-display-prefs";
import {
  recordViewApi,
  type RecordView,
  type RecordViewQueryOptions,
} from "./record-view-api";

export function readLegacyViews(key: string): unknown[] {
  const text = localStorage.getItem(key);
  if (!text) return [];
  try {
    const entries: unknown = JSON.parse(text);
    if (Array.isArray(entries)) return entries;
  } catch {
    /* Keep an unreadable source in local storage for recovery. */
  }
  return [text];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function convert(entry: unknown, schema: RuntimeObjectSchema) {
  const invalid = "原方案格式无法无损转换";
  if (
    !object(entry) ||
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    !object(entry.query)
  )
    throw new Error(invalid);
  const { filters, sort, direction, page, limit, ...queryOptions } =
    entry.query;
  if (
    typeof sort !== "string" ||
    (direction !== "asc" && direction !== "desc") ||
    !object(filters) ||
    Object.keys(queryOptions).some(
      (key) =>
        ![
          "scope",
          "poolStage",
          "poolQuality",
          "search",
          "ownerMemberId",
        ].includes(key),
    ) ||
    (page !== undefined && typeof page !== "number") ||
    (limit !== undefined && typeof limit !== "number")
  )
    throw new Error(invalid);
  const fields = queryFields(schema);
  if (
    Object.keys(filters).some(
      (key) => !fields.some((field) => field.fieldKey === key),
    )
  )
    throw new Error("条件所用的字段已停用或不可见");
  let filterRule: FilterRule;
  try {
    filterRule = legacyFiltersToRule(filters, fields);
  } catch {
    throw new Error(invalid);
  }
  for (const condition of filterRule.conditions) {
    if (!("fieldKey" in condition) || !Array.isArray(condition.value)) continue;
    const field = fields.find((field) => field.fieldKey === condition.fieldKey);
    if (!field || !["SINGLE_SELECT", "MULTI_SELECT"].includes(field.type))
      continue;
    const active = new Set(
      selectOptions(field)
        .filter((option) => option.status === "ACTIVE")
        .map((option) => option.key),
    );
    if (condition.value.some((value) => !active.has(value)))
      throw new Error("筛选选项已停用或被移除");
  }
  return {
    name: entry.name,
    filterRule,
    sort: { field: sort, direction } as const,
    queryOptions: queryOptions as RecordViewQueryOptions,
  };
}

export function viewError(error: unknown): string {
  if (object(error) && typeof error.message === "string") return error.message;
  return "操作失败，请重试";
}

export async function importLegacyViews(
  key: string,
  tenantCode: string,
  objectCode: string,
  schema: RuntimeObjectSchema,
  memberId: string,
  onSaved: (view: RecordView) => void,
) {
  const failures: string[] = [];
  const columnFieldKeys = resolveRecordColumnKeys(
    schema,
    readDisplayPrefs(tenantCode, memberId, objectCode, localStorage).columns,
  );
  for (const entry of readLegacyViews(key)) {
    const original = JSON.stringify(entry);
    try {
      const settings = convert(entry, schema);
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(original),
      );
      const importKey = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const view = await recordViewApi.create(tenantCode, objectCode, {
        ...settings,
        scope: "PERSONAL",
        importKey,
        columnFieldKeys,
      });
      onSaved(view);
      // Another tab may have added or edited a scheme while the request was in flight.
      const current = readLegacyViews(key);
      const index = current.findIndex(
        (item) => JSON.stringify(item) === original,
      );
      if (index !== -1) {
        current.splice(index, 1);
        localStorage.setItem(key, JSON.stringify(current));
      }
    } catch (error) {
      const name =
        object(entry) && typeof entry.name === "string"
          ? entry.name
          : "未命名方案";
      failures.push(`${name} · ${viewError(error)}`);
    }
  }
  return failures;
}
