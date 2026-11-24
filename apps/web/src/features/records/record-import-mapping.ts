import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import {
  coerceImportValue,
  suggestFieldKey,
  inferImportDateOrder,
  type ParsedCsv,
} from "./record-csv";
import type {
  ImportDestination,
  PlannedImportRow,
} from "./record-import-groups";

export const SKIP = ":skip";
export const OWNER = ":owner";
export const APPEND = ":append:";
export const ownerHeader = (header: string) =>
  /负责人|跟进人|销售|业务员|归属/.test(
    header.normalize("NFKC").replace(/\s/g, ""),
  );
export function initialMapping(
  headers: string[],
  fields: PublishedFieldView[],
  admin: boolean,
) {
  const owners = headers.filter(ownerHeader).length;
  return headers.map((header) =>
    ownerHeader(header)
      ? admin && owners === 1
        ? OWNER
        : SKIP
      : (suggestFieldKey(header, fields) ?? SKIP),
  );
}

export function buildImportRows(input: {
  parsed: ParsedCsv;
  mapping: string[];
  fields: PublishedFieldView[];
  timeZone?: string;
  dateOrders: Record<number, "DMY" | "MDY" | undefined>;
  amountUnits?: Record<number, "wan" | "yuan">;
  valueChoices?: Record<number, ReadonlyMap<string, string | null>>;
  destination: (row: string[]) => ImportDestination;
}): PlannedImportRow[] {
  const { parsed, mapping, timeZone, dateOrders, destination } = input;
  const fields = new Map(input.fields.map((field) => [field.fieldKey, field]));
  const orders = mapping.map((key, i) => {
    if (dateOrders[i]) return dateOrders[i];
    const field = fields.get(key);
    if (field?.type !== "DATE" && field?.type !== "DATETIME") return;
    const inferred = inferImportDateOrder(parsed.rows.map((r) => r[i] ?? ""));
    if (inferred === "DMY" || inferred === "MDY") return inferred;
  });
  return parsed.rows.map((row, i) => {
    const planned: PlannedImportRow = {
      rowNumber: parsed.rowNumbers?.[i] ?? i + 2,
      values: {},
      destination: destination(row),
    };
    if (planned.destination.kind === "skip") return planned;
    const errors: string[] = [];
    for (const [column, key] of mapping.entries()) {
      const field = fields.get(key);
      if (!field) continue;
      try {
        planned.values[key] = coerceImportValue(
          field.type,
          row[column] ?? "",
          selectOptions(field).filter((option) => option.status === "ACTIVE"),
          {
            timeZone,
            dateOrder: orders[column],
            bareAmountUnit: input.amountUnits?.[column],
            valueChoices: input.valueChoices?.[column],
          },
        );
      } catch (e) {
        errors.push(
          `${field.label}：${e instanceof Error ? e.message : "字段值无效"}`,
        );
      }
    }
    if (errors.length) {
      planned.error = {
        code: "RECORD_IMPORT_INVALID",
        message: errors.join("；"),
      };
      return planned;
    }
    for (const [column, target] of mapping.entries()) {
      if (!target.startsWith(APPEND)) continue;
      const key = target.slice(APPEND.length);
      if (fields.get(key)?.type !== "TEXTAREA") continue;
      const raw = (row[column] ?? "").trim().replace(/[\r\n]+/g, " ");
      if (raw)
        planned.values[key] = [
          planned.values[key],
          (parsed.headers[column] || `第 ${column + 1} 列`) + "：" + raw,
        ]
          .filter(Boolean)
          .join("\n");
    }
    return planned;
  });
}
