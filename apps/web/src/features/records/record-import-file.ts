import type { ParsingOptions } from "xlsx";
import { parseCsvRows, type SourceRow } from "@/lib/csv";
import type { RecordImportResultItem } from "./record-api";
import {
  decodeRecordCsv,
  suggestFieldKey,
  RECORD_IMPORT_MAX_COLUMNS,
  RECORD_IMPORT_MAX_ROWS,
  type CsvEncoding,
  type ParsedCsv,
} from "./record-csv";

const HEADER_ROW_LIMIT = 10;
const ROW_LIMIT_ERROR = `单个工作表最多 ${RECORD_IMPORT_MAX_ROWS} 行，请拆分工作表。`;
type MatchFields = Parameters<typeof suggestFieldKey>[1];

export interface HeaderSelection {
  headerRow: number;
  detected: boolean;
  candidates: SourceRow[];
}
export interface ImportFile {
  bytes: Uint8Array;
  encoding?: string;
  sheetNames: string[];
  headerSelection: (name: string, fields: MatchFields) => HeaderSelection;
  sheet: (name: string, headerRow?: number) => ParsedCsv;
}

function looksLikeLabel(value: string) {
  return (
    value.length <= 40 &&
    /\p{L}/u.test(value) &&
    !/[\n\r@]/.test(value) &&
    !/^[-+]?\d/.test(value)
  );
}

function selectHeader(rows: SourceRow[], fields: MatchFields): HeaderSelection {
  const leadingRows = rows
    .slice(0, HEADER_ROW_LIMIT)
    .filter((row) => row.rowNumber <= HEADER_ROW_LIMIT);
  if (!leadingRows.length) throw new Error("文件前 10 行没有可选的非空表头。");
  const candidates = leadingRows.map(({ rowNumber, cells }) => ({
    rowNumber,
    cells: Array.from(
      cells.slice(0, RECORD_IMPORT_MAX_COLUMNS),
      (value) => value ?? "",
    ),
  }));
  const scores = candidates.map(({ cells }, index) => {
    if (
      !rows[index + 1] ||
      leadingRows[index].cells.length > RECORD_IMPORT_MAX_COLUMNS
    )
      return { index, matches: 0, shaped: false };
    const keys = cells
      .map((cell) => suggestFieldKey(cell, fields))
      .filter(Boolean);
    const labels = cells.map((cell) => cell.trim()).filter(Boolean);
    const shortLabels = labels.filter(looksLikeLabel).length;
    const shaped =
      shortLabels >= 2 &&
      shortLabels > labels.length / 2 &&
      rows.slice(index + 1, index + 4).some((row) => {
        const belowLabels = cells
          .map((label, i) => label.trim() && row.cells[i]?.trim())
          .filter(Boolean);
        return (
          belowLabels.length >= 2 &&
          belowLabels.some((value) => !looksLikeLabel(value))
        );
      });
    return { index, matches: new Set(keys).size, shaped };
  });
  const mostMatches = Math.max(...scores.map((candidate) => candidate.matches));
  const best = scores.filter((candidate) => candidate.matches === mostMatches);
  const shaped = best.filter((candidate) => candidate.shaped);
  const found =
    mostMatches > 0 && best.length === 1
      ? best[0]
      : mostMatches === 0 || shaped.length === 1
        ? shaped[0]
        : undefined;
  return {
    candidates,
    headerRow: candidates[found?.index ?? 0].rowNumber,
    detected: !!found,
  };
}

function readTable(
  rows: SourceRow[],
  headerRow: number | undefined,
  isCsv: boolean,
): ParsedCsv {
  const index =
    headerRow === undefined
      ? 0
      : rows.findIndex((row) => row.rowNumber === headerRow);
  const header = rows[index];
  if (!header || (headerRow !== undefined && headerRow > HEADER_ROW_LIMIT))
    throw new Error("请选择文件前 10 行中的非空表头。");
  const body = rows.slice(index + 1);
  if (!body.length) throw new Error("文件没有数据行。");
  if (body.length > RECORD_IMPORT_MAX_ROWS) throw new Error(ROW_LIMIT_ERROR);
  const width = body.reduce(
    (width, row) => Math.max(width, row.cells.length),
    header.cells.length,
  );
  if (width > RECORD_IMPORT_MAX_COLUMNS)
    throw new Error(`最多 ${RECORD_IMPORT_MAX_COLUMNS} 列。`);
  if (isCsv && width > header.cells.length)
    throw new Error("名单列数与表头不一致");
  const pad = (cells: string[]) =>
    Array.from({ length: width }, (_, i) => cells[i] ?? "");
  return {
    headers: pad(header.cells).map((label) => label.trim()),
    rows: body.map((row) => pad(row.cells)),
    rowNumbers: body.map((row) => row.rowNumber),
  };
}

export async function readImportFile(
  file: File,
  encoding: CsvEncoding,
): Promise<ImportFile> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("文件最大 10 MB，请删去无关工作表或拆分文件。");
  const extension = file.name.toLowerCase().split(".").pop();
  if (!["csv", "xls", "xlsx"].includes(extension ?? ""))
    throw new Error("请选择 CSV、XLS 或 XLSX 文件。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === "csv") {
    const decoded = decodeRecordCsv(bytes, encoding);
    const rows: SourceRow[] = [];
    for (const record of parseCsvRows(decoded.text)) {
      if (rows.length === RECORD_IMPORT_MAX_ROWS + HEADER_ROW_LIMIT)
        throw new Error(ROW_LIMIT_ERROR);
      rows.push(record);
    }
    return {
      bytes,
      encoding: decoded.encoding,
      sheetNames: [],
      headerSelection: (_, fields) => selectHeader(rows, fields),
      sheet: (_, headerRow) => readTable(rows, headerRow, true),
    };
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle =
    bytes
      .slice(0, 8)
      .every(
        (b, i) => b === [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1][i],
      ) && bytes.length >= 8;
  const isBiff = bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1]);
  if (extension === "xlsx" ? !isZip : !(isOle || isBiff))
    throw new Error(
      "文件格式与后缀不符，请用 Excel 另存为真正的 XLSX / XLS 文件。",
    );
  const XLSX = await import("xlsx");
  // Legacy XLS codepages are an optional module in SheetJS's ESM build.
  const codepages = await import("xlsx/dist/cpexcel.full.mjs");
  XLSX.set_cptable(codepages);
  function readWorkbook(options: ParsingOptions) {
    try {
      return XLSX.read(bytes, { type: "array", ...options });
    } catch {
      throw new Error(
        "无法读取 Excel 文件，请检查文件是否损坏或加密，然后另存为 XLSX 重试。",
      );
    }
  }
  const sheetNames = readWorkbook({ bookSheets: true }).SheetNames;
  if (!sheetNames.length) throw new Error("Excel 文件没有工作表。");
  let cachedName: string | undefined;
  let cachedRows: SourceRow[] = [];
  function excelRows(name: string): SourceRow[] {
    if (name === cachedName) return cachedRows;
    if (!sheetNames.includes(name)) throw new Error("请选择有效的工作表。");
    // A sparse sheet can contain a valid data row far past row 10,010.
    // sheetRows can silently discard it when the file omits dimension metadata.
    const workbook = readWorkbook({
      sheets: name,
      cellNF: true,
      cellFormula: true,
      sheetStubs: true,
    });
    const ws = workbook.Sheets[name];
    if (!ws) throw new Error("无法读取工作表，请在 Excel 中另存为 XLSX 重试。");
    const byNumber = new Map<number, string[]>();
    for (const address of Object.keys(ws)) {
      if (address.startsWith("!")) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      const cell = ws[address];
      if (cell.t === "e" || (cell.f && (cell.t === "z" || cell.v == null)))
        throw new Error(
          `第 ${r + 1} 行存在错误或未计算的公式，请在 Excel 中重新计算并保存。`,
        );
      if (cell.t === "z" || cell.v == null) continue;
      let value = String(cell.v);
      if (cell.t === "n") {
        if (cell.z && XLSX.SSF.is_date(cell.z)) {
          const date = XLSX.SSF.parse_date_code(cell.v as number, {
            date1904: workbook.Workbook?.WBProps?.date1904,
          });
          if (
            !date ||
            date.m < 1 ||
            date.d < 1 ||
            (date.y === 1900 && date.m === 2 && date.d === 29)
          )
            throw new Error(`第 ${r + 1} 行日期无效。`);
          const pad = (n: number) => String(n).padStart(2, "0");
          value = `${date.y}-${pad(date.m)}-${pad(date.d)}`;
          if (date.H || date.M || date.S)
            value += ` ${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
        } else if (typeof cell.z === "string" && /^0+$/.test(cell.z)) {
          value = XLSX.utils.format_cell(cell);
        }
      }

      if (value.includes("\uFFFD"))
        throw new Error("文件含有乱码替代字符（�），请使用未损坏的原表。");
      const number = r + 1;
      const cells = byNumber.get(number) ?? [];
      cells[c] = value;
      byNumber.set(number, cells);
    }
    cachedRows = Array.from(byNumber, ([rowNumber, cells]) => ({
      rowNumber,
      cells,
    }))
      .filter((row) => row.cells.some((value) => value.trim()))
      .sort((a, b) => a.rowNumber - b.rowNumber);
    cachedName = name;
    return cachedRows;
  }
  return {
    bytes,
    sheetNames,
    headerSelection: (name, fields) => selectHeader(excelRows(name), fields),
    sheet: (name, headerRow) => readTable(excelRows(name), headerRow, false),
  };
}

export async function importBatchId(
  bytes: Uint8Array,
  sheetName: string,
): Promise<string> {
  const suffix = new TextEncoder().encode(
    `\0crm-record-import-v1\0${sheetName}`,
  );
  const input = new Uint8Array(bytes.length + suffix.length);
  input.set(bytes);
  input.set(suffix, bytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importRowError(
  item: RecordImportResultItem,
  fields: MatchFields,
): string {
  const labels = item.error?.fields?.map(
    (key) => fields.find((field) => field.fieldKey === key)?.label ?? key,
  );
  return `第 ${item.rowNumber} 行：${labels?.length ? labels.join("、") + "：" : ""}${item.error?.message ?? "导入失败"}`;
}

export function importFailureCsv(
  sheet: ParsedCsv,
  items: RecordImportResultItem[],
  fields: MatchFields,
): string {
  const byNumber = new Map(
    sheet.rows.map((row, i) => [sheet.rowNumbers?.[i] ?? i + 2, row]),
  );
  const rows = [
    ["源文件行号", "失败原因", ...sheet.headers],
    ...items
      .filter((item) => item.status === "FAILED")
      .map((item) => [
        String(item.rowNumber),
        importRowError(item, fields),
        ...(byNumber.get(item.rowNumber) ?? []),
      ]),
  ];
  const escape = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
