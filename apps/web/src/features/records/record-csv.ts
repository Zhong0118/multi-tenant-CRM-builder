export const RECORD_IMPORT_MAX_ROWS = 500;
export const RECORD_IMPORT_MAX_COLUMNS = 40;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      if (cell.endsWith("\r")) cell = cell.slice(0, -1);
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((header) => header.trim());
  return {
    headers,
    rows: rows.slice(1).map((values) => {
      const padded = [...values];
      while (padded.length < headers.length) padded.push("");
      return padded.slice(0, headers.length);
    }),
  };
}

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
      if (["否", "false", "0", "no"].includes(value.toLowerCase())) return false;
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
