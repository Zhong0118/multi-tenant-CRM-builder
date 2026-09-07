import { FIELD_KEY_PATTERN } from "@/features/objects/object-types";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";

export const RECORD_COLUMNS_KEY_PREFIX = "crm.records.columns";

export function recordColumnsStorageKey(
  tenantCode: string,
  objectCode: string,
): string {
  return `${RECORD_COLUMNS_KEY_PREFIX}.${tenantCode}.${objectCode}`;
}

export function defaultRecordColumnKeys(
  schema: RuntimeObjectSchema,
): string[] {
  return schema.defaultView.columnFieldKeys.filter((fieldKey) =>
    schema.fields.some(
      (field) => field.fieldKey === fieldKey && field.access !== "HIDDEN",
    ),
  );
}

export function resolveRecordColumnKeys(
  schema: RuntimeObjectSchema,
  requested: string[] | undefined,
): string[] {
  const visible = new Set(
    schema.fields
      .filter((field) => field.access !== "HIDDEN")
      .map((field) => field.fieldKey),
  );
  const selected = (requested ?? []).filter((fieldKey) => visible.has(fieldKey));
  if (selected.length > 0) return [...new Set(selected)];
  const fallback = defaultRecordColumnKeys(schema);
  return fallback.length > 0 ? fallback : [...visible];
}

export function parseStoredRecordColumnKeys(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string =>
        typeof item === "string" && FIELD_KEY_PATTERN.test(item),
    );
  } catch {
    return [];
  }
}

export function readStoredRecordColumnKeys(
  tenantCode: string,
  objectCode: string,
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  return parseStoredRecordColumnKeys(
    storage.getItem(recordColumnsStorageKey(tenantCode, objectCode)),
  );
}

export function writeStoredRecordColumnKeys(
  tenantCode: string,
  objectCode: string,
  fieldKeys: string[],
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  storage?.setItem(
    recordColumnsStorageKey(tenantCode, objectCode),
    JSON.stringify(fieldKeys),
  );
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
