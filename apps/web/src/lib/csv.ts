export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(
  text: string,
  options: { delimiter?: "," | "\t"; strictColumnCount?: boolean } = {},
): ParsedCsv {
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
    if (char === (options.delimiter ?? ",")) {
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
      if (options.strictColumnCount && values.length > headers.length)
        throw new Error("名单列数与表头不一致");
      const padded = [...values];
      while (padded.length < headers.length) padded.push("");
      return padded.slice(0, headers.length);
    }),
  };
}
