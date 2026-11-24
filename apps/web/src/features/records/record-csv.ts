import { coerceImportDate, type ImportDateOrder } from "./record-import-date";

export {
  inferImportDateOrder,
  type ImportDateOrder,
} from "./record-import-date";

export const RECORD_IMPORT_MAX_ROWS = 10000;
export const RECORD_IMPORT_MAX_COLUMNS = 40;

export { parseCsv, type ParsedCsv } from "@/lib/csv";

export type CsvEncoding = "auto" | "utf-8" | "gb18030";

export function decodeRecordCsv(bytes: Uint8Array, encoding: CsvEncoding) {
  let decoder: string = encoding === "auto" ? "utf-8" : encoding;
  if (encoding === "auto") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = "utf-16be";
  }

  let text: string;
  try {
    text = new TextDecoder(decoder, { fatal: true }).decode(bytes);
  } catch {
    if (
      encoding === "auto" &&
      decoder === "utf-8" &&
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ) {
      return decodeRecordCsv(bytes, "gb18030");
    }
    const label =
      decoder === "gb18030" ? "GBK / GB18030" : decoder.toUpperCase();
    throw new Error(
      `无法按 ${label} 读取。请尝试 GBK / GB18030，或在 Excel 中另存为 CSV UTF-8 后重选文件。`,
    );
  }
  if (text.includes("\uFFFD")) {
    throw new Error(
      "文件含有乱码替代字符（�），请从未损坏的原表重新导出 CSV UTF-8。",
    );
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(
      "文件不是有效的 CSV 文本。请另存为 CSV UTF-8，不要直接修改 Excel 文件后缀。",
    );
  }
  return {
    text,
    encoding: decoder === "gb18030" ? "GBK / GB18030" : decoder.toUpperCase(),
  };
}

export function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[.:;,!?。、]+$/u, "")
    .toLowerCase();
}

export function suggestFieldKey(
  header: string,
  fields: Array<{ fieldKey: string; label: string }>,
): string | undefined {
  const normalized = normalizeHeader(header);
  if (!normalized) return undefined;
  const matches = fields.filter(
    (field) =>
      normalizeHeader(field.fieldKey) === normalized ||
      normalizeHeader(field.label) === normalized,
  );
  return matches.length === 1 ? matches[0].fieldKey : undefined;
}

type ImportOption = { key: string; label: string };

export interface ImportValueContext {
  timeZone?: string;
  dateOrder?: ImportDateOrder;
  valueChoices?: ReadonlyMap<string, string | null>;
  bareAmountUnit?: "yuan" | "wan";
}

function normalizeOption(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, "");
}

export function matchImportOption(
  value: string,
  options: ImportOption[],
): string | undefined {
  const normalized = normalizeOption(value);
  if (!normalized) return undefined;
  const matches = options.filter(
    (option) =>
      normalizeOption(option.key) === normalized ||
      normalizeOption(option.label) === normalized,
  );
  return matches.length === 1 ? matches[0].key : undefined;
}

export function splitImportOptions(value: string): string[] {
  return value
    .split(/[;；,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function coerceImportValue(
  type: string,
  raw: string,
  options: ImportOption[],
  context: ImportValueContext = {},
): unknown {
  const value = raw.trim();
  if (value === "") return null;
  switch (type) {
    case "BOOLEAN":
      if (
        ["是", "true", "1", "yes", "有", "y", "√"].includes(value.toLowerCase())
      )
        return true;
      if (
        ["否", "false", "0", "no", "无", "n", "×"].includes(value.toLowerCase())
      )
        return false;
      throw new Error("无法识别是否值");
    case "NUMBER":
    case "MONEY":
      return coerceDecimal(value, type, context.bareAmountUnit);
    case "SINGLE_SELECT":
    case "MULTI_SELECT": {
      const parts =
        type === "SINGLE_SELECT" ? [value] : splitImportOptions(value);
      const keys = parts.map((part) => {
        const exact = matchImportOption(part, options);
        if (exact !== undefined) return exact;
        const choice = context.valueChoices?.get(part);
        return choice === null || options.some((option) => option.key === choice)
          ? choice
          : undefined;
      });
      if (keys.includes(null)) return null;
      if (keys.includes(undefined)) throw new Error("取值未对应唯一选项");
      return type === "SINGLE_SELECT" ? keys[0] : [...new Set(keys)];
    }
    case "DATE":
    case "DATETIME":
      return coerceImportDate(type, value, context);
    default:
      return value;
  }
}

function coerceDecimal(
  value: string,
  type: "NUMBER" | "MONEY",
  bareUnit?: "yuan" | "wan",
) {
  value = value.normalize("NFKC").replace(/(\d) +(?=[万亿元])/, "$1");
  // Excel may stringify small or large numeric cells in scientific notation.
  let exponent = "";
  if (type === "NUMBER") {
    const plain = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.exec(value);
    if (plain) {
      const mantissa = plain[2].replace(/^\./, "0.").replace(/\.$/, "");
      value = plain[1] + mantissa;
      exponent = plain[3] ?? "";
    }
  }
  const match =
    /^([+-]?)([¥￥]?)([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(亿元?|万元?|元)?$/.exec(
      value,
    );
  if (!match || (match[1] && match[3]))
    throw new Error("数值格式无效，请检查符号、千分位和单位");
  const [, firstSign, currency, secondSign, integer, fraction = "", unit] =
    match;
  const shift = unit?.startsWith("亿")
    ? 8
    : unit?.startsWith("万") || (!unit && !currency && bareUnit === "wan")
      ? 4
      : 0;
  const whole = (
    integer.replace(/,/g, "") + fraction.slice(0, shift).padEnd(shift, "0")
  ).replace(/^0+(?=\d)/, "");
  const rest = fraction.slice(shift);
  const sign = firstSign === "-" || secondSign === "-" ? "-" : "";
  const decimal = sign + whole + (rest ? "." + rest : "");
  const number = Number(decimal + exponent);
  if (!Number.isFinite(number)) throw new Error("数值超出范围");
  if (type === "MONEY") return decimal;

  // JSON numbers retain only the digits in their shortest decimal representation.
  const digits = (whole + rest).replace(/^0+/, "");
  if (digits) {
    const [mantissa, storedExponent] = Math.abs(number)
      .toExponential()
      .split("e");
    const sourceExponent =
      digits.length - rest.length - 1 + Number(exponent.slice(1));
    if (
      Number(storedExponent) !== sourceExponent ||
      mantissa.replace(".", "").padEnd(digits.length, "0") !== digits
    ) {
      throw new Error("超出数值字段可保留的精度");
    }
  }
  return number;
}
