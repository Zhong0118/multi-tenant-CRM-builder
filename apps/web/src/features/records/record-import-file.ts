import type { WorkBook } from "xlsx";
import type { RecordImportResultItem } from "./record-api";
import {
  decodeRecordCsv,
  parseCsv,
  RECORD_IMPORT_MAX_COLUMNS,
  RECORD_IMPORT_MAX_ROWS,
  type CsvEncoding,
  type ParsedCsv,
} from "./record-csv";

export interface ImportFile {
  bytes: Uint8Array;
  encoding?: string;
  sheetNames: string[];
  sheet: (name: string) => ParsedCsv;
}

function checkSheet(sheet: ParsedCsv): ParsedCsv {
  if (!sheet.headers.length || !sheet.rows.length)
    throw new Error("文件没有数据行。");
  if (sheet.headers.length > RECORD_IMPORT_MAX_COLUMNS)
    throw new Error(`最多 ${RECORD_IMPORT_MAX_COLUMNS} 列。`);
  if (sheet.rows.length > RECORD_IMPORT_MAX_ROWS)
    throw new Error(
      `单个工作表最多 ${RECORD_IMPORT_MAX_ROWS} 行，请拆分工作表。`,
    );
  if (
    [...sheet.headers, ...sheet.rows.flat()].some((cell) =>
      cell.includes("\uFFFD"),
    )
  )
    throw new Error("文件含有乱码替代字符（�），请使用未损坏的原表。");
  return sheet;
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
    const parsed = checkSheet(
      parseCsv(decoded.text, {
        strictColumnCount: true,
        trackRowNumbers: true,
      }),
    );
    return {
      bytes,
      encoding: decoded.encoding,
      sheetNames: [],
      sheet: () => parsed,
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
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellNF: true,
      cellFormula: true,
      sheetRows: RECORD_IMPORT_MAX_ROWS + 2,
    });
  } catch {
    throw new Error(
      "无法读取 Excel 文件，请检查文件是否损坏或加密，然后另存为 XLSX 重试。",
    );
  }
  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) throw new Error("Excel 文件没有工作表。");
  return {
    bytes,
    sheetNames,
    sheet: (name) => {
      const ws = workbook.Sheets[name];
      if (!ws) throw new Error("请选择有效的工作表。");
      const range = XLSX.utils.decode_range(
        ws["!fullref"] ?? ws["!ref"] ?? "A1",
      );
      if (range.e.r > RECORD_IMPORT_MAX_ROWS)
        throw new Error(
          `单个工作表最多 ${RECORD_IMPORT_MAX_ROWS} 行，请拆分工作表。`,
        );
      if (range.e.c >= RECORD_IMPORT_MAX_COLUMNS)
        throw new Error(`最多 ${RECORD_IMPORT_MAX_COLUMNS} 列。`);
      const matrix: string[][] = [];
      const rowNumbers: number[] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell?.t === "e" || (cell?.f && cell.v == null))
            throw new Error(
              `第 ${r + 1} 行存在错误或未计算的公式，请在 Excel 中重新计算并保存。`,
            );
          let value = cell?.v == null ? "" : String(cell.v);
          if (cell?.t === "n") {
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
          row.push(value);
        }
        if (row.some((v) => v.trim())) {
          matrix.push(row);
          rowNumbers.push(r + 1);
        }
      }
      return checkSheet({
        headers: (matrix[0] ?? []).map((v) => v.trim()),
        rows: matrix.slice(1),
        rowNumbers: rowNumbers.slice(1),
      });
    },
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

export function importFailureCsv(
  sheet: ParsedCsv,
  items: RecordImportResultItem[],
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
        item.error?.message ?? "导入失败",
        ...(byNumber.get(item.rowNumber) ?? []),
      ]),
  ];
  const escape = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
