export const RECORD_IMPORT_MAX_ROWS = 500;
export const RECORD_IMPORT_MAX_COLUMNS = 40;

export { parseCsv, type ParsedCsv } from "@/lib/csv";

export function suggestFieldKey(
  header: string,
  fields: Array<{ fieldKey: string; label: string }>,
): string | undefined {
  const normalized = header.trim().toLowerCase();
  return fields.find(
    (field) =>
      field.fieldKey === header.trim() ||
      field.label === header.trim() ||
      field.fieldKey.toLowerCase() === normalized ||
      field.label.toLowerCase() === normalized,
  )?.fieldKey;
}

export function coerceImportValue(
  type: string,
  raw: string,
  options: Array<{ key: string; label: string }>,
): unknown {
  const value = raw.trim();
  if (value === "") return null;
  switch (type) {
    case "BOOLEAN":
      if (["是", "true", "1", "yes"].includes(value.toLowerCase())) return true;
      if (["否", "false", "0", "no"].includes(value.toLowerCase()))
        return false;
      return value;
    case "NUMBER": {
      const numeric = Number(value.replace(/,/g, ""));
      return Number.isFinite(numeric) ? numeric : value;
    }
    case "MONEY":
      return value.replace(/,/g, "").replace(/^¥/, "");
    case "SINGLE_SELECT":
      return matchOption(value, options) ?? value;
    case "MULTI_SELECT":
      return value
        .split(/[;；,，]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => matchOption(part, options) ?? part);
    case "DATETIME":
      return coerceDateTime(value);
    case "DATE":
      return coerceDate(value);
    default:
      return value;
  }
}

function matchOption(
  value: string,
  options: Array<{ key: string; label: string }>,
): string | undefined {
  return options.find(
    (option) => option.key === value || option.label === value,
  )?.key;
}

function coerceDate(value: string): string {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function coerceDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return value;
  const seconds = match[6] ?? "00";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${seconds}.000Z`;
}
