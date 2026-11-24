export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  rowNumbers?: number[];
}

export interface SourceRow {
  rowNumber: number;
  cells: string[];
}

export function* parseCsvRows(
  text: string,
  delimiter: "," | "\t" = ",",
): Generator<SourceRow> {
  const source = text.replace(/^\uFEFF/, "");
  let line = 1;
  let rowLine = 1;
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\n") line += 1;
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
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      if (cell.endsWith("\r")) cell = cell.slice(0, -1);
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        yield { cells: row, rowNumber: rowLine };
      }
      rowLine = line;
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) {
      yield { cells: row, rowNumber: rowLine };
    }
  }
}

export function parseCsv(
  text: string,
  options: {
    delimiter?: "," | "\t";
    strictColumnCount?: boolean;
    trackRowNumbers?: boolean;
  } = {},
): ParsedCsv {
  const rows = Array.from(parseCsvRows(text, options.delimiter));
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].cells.map((header) => header.trim());
  return {
    headers,
    ...(options.trackRowNumbers
      ? { rowNumbers: rows.slice(1).map((row) => row.rowNumber) }
      : {}),
    rows: rows.slice(1).map(({ cells: values }) => {
      if (options.strictColumnCount && values.length > headers.length)
        throw new Error("名单列数与表头不一致");
      const padded = [...values];
      while (padded.length < headers.length) padded.push("");
      return padded.slice(0, headers.length);
    }),
  };
}
