import type {
  RecordImportInput,
  RecordImportResult,
  RecordImportResultItem,
} from "./record-api";

export function summarizeImport(
  items: RecordImportResultItem[],
): RecordImportResult {
  return {
    items,
    created: items.filter((i) => i.status === "CREATED").length,
    failed: items.filter((i) => i.status === "FAILED").length,
    skipped: items.filter((i) => i.status === "SKIPPED").length,
  };
}

export async function runImportBatches({
  input,
  request,
  onBatch,
  shouldStop,
}: {
  input: RecordImportInput;
  request: (input: RecordImportInput) => Promise<RecordImportResult>;
  onBatch: (result: RecordImportResult) => void;
  shouldStop: () => boolean;
}) {
  const seen = new Set<string>();
  for (let start = 0; start < input.rows.length && !shouldStop();) {
    const rows: RecordImportInput["rows"] = [];
    // Nest's default JSON body limit is 100 KiB. Leave room for envelope fields.
    let bytes = new TextEncoder().encode(
      JSON.stringify({ ...input, rows: [] }),
    ).length;
    while (start < input.rows.length && rows.length < 100) {
      const row = input.rows[start];
      const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
      if (size > 80 * 1024) {
        if (rows.length) break;
        onBatch(
          summarizeImport([
            {
              rowNumber: row.rowNumber,
              status: "FAILED",
              error: {
                code: "RECORD_IMPORT_INVALID",
                message: "该行内容过长，请缩短单元格内容后重新导入。",
              },
            },
          ]),
        );
        start += 1;
        continue;
      }
      if (bytes + size > 90 * 1024) break;
      rows.push(row);
      bytes += size;
      start += 1;
    }
    if (!rows.length) continue;
    const result = await request({ ...input, rows });
    if (
      result.items.length !== rows.length ||
      new Set(result.items.map((i) => i.rowNumber)).size !== rows.length ||
      result.items.some((i) => !rows.some((r) => r.rowNumber === i.rowNumber))
    )
      throw new Error("导入结果不完整，请重新检查后继续。");
    const items = result.items.map((item): RecordImportResultItem => {
      if (!input.dryRun || item.status !== "READY" || !item.matchKey)
        return item;
      if (seen.has(item.matchKey))
        return {
          rowNumber: item.rowNumber,
          status: "SKIPPED",
          reason: "文件内查重字段重复",
        };
      seen.add(item.matchKey);
      return item;
    });
    onBatch(summarizeImport(items));
  }
}
