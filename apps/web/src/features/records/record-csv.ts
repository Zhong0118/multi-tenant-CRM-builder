export const RECORD_IMPORT_MAX_ROWS = 500;
export const RECORD_IMPORT_MAX_COLUMNS = 40;

export { parseCsv, type ParsedCsv } from "@/lib/csv";

export type CsvEncoding = "auto" | "utf-8" | "gb18030";

export function decodeRecordCsv(bytes: Uint8Array, encoding: CsvEncoding) {
  let decoder: string = encoding === "auto" ? "utf-8" : encoding;
  if (encoding === "auto") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = "utf-16be";
  }
  const label = decoder === "gb18030" ? "GBK / GB18030" : decoder.toUpperCase();
  let text: string;
  try {
    text = new TextDecoder(decoder, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      `无法按 ${label} 读取。请尝试 GBK / GB18030，或在 Excel 中另存为 CSV UTF-8 后重选文件。`,
    );
  }
  if (text.includes("\uFFFD")) {
    throw new Error(
      "文件含有乱码替代字符（�），请从未损坏的原表重新导出 CSV UTF-8。",
    );
  }
  if (text.includes("\u0000")) {
    throw new Error(
      "文件不是有效的 CSV 文本。请另存为 CSV UTF-8，不要直接修改 Excel 文件后缀。",
    );
  }
  return { text, encoding: label };
}

export function suggestFieldKey(
  header: string,
  fields: Array<{ fieldKey: string; label: string }>,
): string | undefined {
  const normalized = header.trim().toLowerCase();
  const byKey = fields.find(
    (field) => field.fieldKey.toLowerCase() === normalized,
  );
  if (byKey) return byKey.fieldKey;
  const byLabel = fields.filter(
    (field) => field.label.toLowerCase() === normalized,
  );
  return byLabel.length === 1 ? byLabel[0].fieldKey : undefined;
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
