import { FIELD_KEY_PATTERN } from "@/features/objects/object-types";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";

export function defaultRecordColumnKeys(schema: RuntimeObjectSchema): string[] {
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
  const selected = (requested ?? []).filter((fieldKey) =>
    visible.has(fieldKey),
  );
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
