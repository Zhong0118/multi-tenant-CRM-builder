import type { ReactNode } from "react";

import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import type { DynamicFieldMember } from "./dynamic-field";
import type { ParsedCsv } from "./record-csv";
import { displayValue } from "./record-display-value";
import type { PlannedImportRow } from "./record-import-groups";
import styles from "./record-import.module.css";

const CONVERTED = new Set([
  "DATE",
  "DATETIME",
  "MONEY",
  "NUMBER",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "BOOLEAN",
]);

/**
 * The first rows as they will be stored, with the file's own text under any
 * value that changes on the way in: dates, amounts, options and the owner.
 */
export function ImportCheckPreview({
  parsed,
  rows,
  mapping,
  fields,
  members,
  timeZone,
  showOwner,
  limit = 3,
}: {
  parsed: ParsedCsv;
  rows: PlannedImportRow[];
  mapping: string[];
  fields: PublishedFieldView[];
  members: DynamicFieldMember[];
  timeZone?: string;
  showOwner: boolean;
  limit?: number;
}) {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const mapped = mapping.flatMap((key, column) => {
    const field = byKey.get(key);
    return field ? [{ column, field }] : [];
  });
  // The row's name first, then up to four columns whose value is converted.
  const title = mapped.find(({ field }) => !CONVERTED.has(field.type));
  const converted = mapped
    .filter(({ field }) => CONVERTED.has(field.type))
    .slice(0, 4);
  const columns = title ? [title, ...converted] : converted;
  const shown = rows.slice(0, limit);
  if (!shown.length || (!converted.length && !showOwner)) return null;

  const rowIndex = (rowNumber: number) => {
    const index = parsed.rowNumbers?.indexOf(rowNumber) ?? -1;
    return index >= 0 ? index : rowNumber - 2;
  };

  return (
    <div className={styles.preview}>
      <p className={styles.previewTitle}>
        前 {shown.length} 行将这样写入，灰字是文件里的原文：
      </p>
      <div className={styles.previewScroll}>
        <table className={styles.previewTable} aria-label="导入预览">
          <thead>
            <tr>
              {columns.map(({ field }) => (
                <th key={field.fieldKey} scope="col">
                  {field.label}
                </th>
              ))}
              {showOwner ? <th scope="col">负责人</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const source = parsed.rows[rowIndex(row.rowNumber)] ?? [];
              return (
                <tr key={row.rowNumber}>
                  {columns.map(({ column, field }) => (
                    <td key={field.fieldKey}>
                      <Cell
                        written={displayValue(
                          field,
                          row.values[field.fieldKey],
                          members,
                          timeZone,
                        )}
                        plain={plainText(
                          field,
                          row.values[field.fieldKey],
                          source[column] ?? "",
                        )}
                        raw={source[column] ?? ""}
                      />
                    </td>
                  ))}
                  {showOwner ? <td>{owner(row, members)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The stored value as words, to tell whether it reads the same as the file.
function plainText(field: PublishedFieldView, value: unknown, raw: string) {
  if (value === null || value === undefined) return "";
  // "128,000" stored as 128000.00 is the same amount, not a change to point at.
  if (field.type === "MONEY" || field.type === "NUMBER") {
    const typed = Number(raw.replace(/[\s,，¥￥]/g, ""));
    return raw.trim() && typed === Number(value) ? raw.trim() : undefined;
  }
  const label = (key: unknown) =>
    selectOptions(field).find((option) => option.key === key)?.label ??
    String(key);
  if (field.type === "SINGLE_SELECT") return label(value);
  if (field.type === "MULTI_SELECT")
    return (Array.isArray(value) ? value : []).map(label).join("、");
  return undefined;
}

function Cell({
  written,
  plain,
  raw,
}: {
  written: ReactNode;
  plain?: string;
  raw: string;
}) {
  const text = raw.trim();
  const shown = plain ?? (typeof written === "string" ? written : undefined);
  const same = shown !== undefined && shown === text;
  return (
    <>
      {written}
      {text && !same ? <small>{text}</small> : null}
    </>
  );
}

function owner(row: PlannedImportRow, members: DynamicFieldMember[]) {
  const destination = row.destination;
  if (destination.kind === "member")
    return (
      members.find((member) => member.id === destination.id)?.displayName ??
      "其他成员"
    );
  if (destination.kind === "pool") return "公共池";
  if (destination.kind === "default") return "你";
  return "未分配";
}
