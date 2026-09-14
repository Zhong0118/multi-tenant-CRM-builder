"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Drawer, Select, Space, Typography } from "antd";
import { useMemo, useState } from "react";

import {
  selectOptions,
  type PublishedFieldView,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { RecordApi, RecordImportResult } from "./record-api";
import {
  RECORD_IMPORT_MAX_COLUMNS,
  RECORD_IMPORT_MAX_ROWS,
  coerceImportValue,
  parseCsv,
  suggestFieldKey,
  type ParsedCsv,
} from "./record-csv";

import styles from "./records.module.css";

const SKIP = "__skip__";

export interface RecordImportDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  api: RecordApi;
  onClose: () => void;
  onCompleted: (result: RecordImportResult) => void;
}

export function RecordImportDrawer({
  tenantCode,
  schema,
  api,
  onClose,
  onCompleted,
}: RecordImportDrawerProps) {
  const importable = schema.fields.filter(
    (field) => field.access === "EDIT" && field.type !== "MEMBER",
  );
  const [batchId, setBatchId] = useState<string>();
  const [completedRows, setCompletedRows] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState<string>();
  const [parsed, setParsed] = useState<ParsedCsv>();
  const [mapping, setMapping] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string>();
  const [summary, setSummary] = useState<string>();
  const [result, setResult] = useState<RecordImportResult>();

  const mappedFields = useMemo(
    () =>
      mapping
        .map((fieldKey, index) => ({
          index,
          field: importable.find((field) => field.fieldKey === fieldKey),
        }))
        .filter(
          (item): item is { index: number; field: PublishedFieldView } =>
            item.field !== undefined,
        ),
    [importable, mapping],
  );

  const save = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error("missing csv");
      return api.importRows(tenantCode, schema.object.code, {
        batchId,
        rows: parsed.rows
          .map((row, index) => ({
            rowNumber: index + 2,
            values: Object.fromEntries(
              mappedFields.map(({ index: column, field }) => [
                field.fieldKey,
                coerceImportValue(
                  field.type,
                  row[column] ?? "",
                  selectOptions(field).map((option) => ({
                    key: option.key,
                    label: option.label,
                  })),
                ),
              ]),
            ),
          }))
          .filter((row) => !completedRows.has(row.rowNumber)),
      });
    },
    onSuccess: (next) => {
      const merged = new Map(
        result?.items.map((item) => [item.rowNumber, item]) ?? [],
      );
      for (const item of next.items) merged.set(item.rowNumber, item);
      const items = [...merged.values()];
      const combined = {
        items,
        created: items.filter((item) => item.status === "CREATED").length,
        failed: items.filter((item) => item.status === "FAILED").length,
      };
      setCompletedRows(
        new Set(
          items
            .filter((item) => item.status === "CREATED")
            .map((item) => item.rowNumber),
        ),
      );
      setResult(combined);
      setSummary(undefined);
      if (combined.failed === 0) onCompleted(combined);
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setSummary(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  async function onFile(file: File | undefined) {
    setBatchId(crypto.randomUUID());
    setCompletedRows(new Set());
    setParseError(undefined);
    setResult(undefined);
    setSummary(undefined);
    setParsed(undefined);
    setFileName(file?.name);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("只接受 CSV。Excel 请另存为 CSV UTF-8 后再导入。");
      return;
    }
    const text = await file.text();
    let next: ParsedCsv;
    try {
      next = parseCsv(text);
    } catch {
      setParseError("CSV 引号未闭合，请检查文件。");
      return;
    }
    if (next.headers.length === 0 || next.rows.length === 0) {
      setParseError("文件没有数据行。");
      return;
    }
    if (next.headers.length > RECORD_IMPORT_MAX_COLUMNS) {
      setParseError(`最多 ${RECORD_IMPORT_MAX_COLUMNS} 列。`);
      return;
    }
    if (next.rows.length > RECORD_IMPORT_MAX_ROWS) {
      setParseError(`最多导入 ${RECORD_IMPORT_MAX_ROWS} 行。`);
      return;
    }
    setParsed(next);
    setMapping(
      next.headers.map((header) => suggestFieldKey(header, importable) ?? SKIP),
    );
  }

  return (
    <Drawer
      open
      size={560}
      title="导入 CSV"
      aria-label="导入 CSV"
      onClose={onClose}
      destroyOnHidden
    >
      {parseError ? <Alert type="error" showIcon title={parseError} /> : null}
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      {result ? (
        <Alert
          type={result.failed === 0 ? "success" : "warning"}
          showIcon
          title={`成功 ${result.created} 行，失败 ${result.failed} 行。失败行不会写入。`}
        />
      ) : null}

      <Typography.Paragraph type="secondary">
        先把 Excel 另存为
        CSV。每一列必须映射到一个可写字段，或明确跳过。成员字段不能导入。成功行立即写入，失败行单独列出。
      </Typography.Paragraph>

      <input
        type="file"
        disabled={save.isPending}
        accept=".csv,text/csv"
        aria-label="选择 CSV 文件"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      {fileName ? (
        <Typography.Paragraph>{fileName}</Typography.Paragraph>
      ) : null}

      {parsed ? (
        <>
          <Typography.Paragraph>
            {parsed.rows.length} 行 · {parsed.headers.length} 列
          </Typography.Paragraph>
          <div className={styles.columnChooser}>
            {parsed.headers.map((header, index) => (
              <label
                key={`${header}-${index}`}
                className={styles.columnChooserRow}
              >
                <span>{header || `第 ${index + 1} 列`}</span>
                <Select
                  disabled={save.isPending}
                  aria-label={`映射 ${header || `第 ${index + 1} 列`}`}
                  className={styles.importMap}
                  value={mapping[index]}
                  onChange={(next) =>
                    setMapping((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? next : value,
                      ),
                    )
                  }
                  options={[
                    { value: SKIP, label: "跳过此列" },
                    ...importable.map((field) => ({
                      value: field.fieldKey,
                      label: field.required
                        ? `${field.label}（必填）`
                        : field.label,
                    })),
                  ]}
                />
              </label>
            ))}
          </div>
          <table className={styles.importPreview}>
            <caption>前 3 行预览</caption>
            <thead>
              <tr>
                {parsed.headers.map((header, index) => (
                  <th key={`${header}-${index}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, 3).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {result && result.failed > 0 ? (
        <ul className={styles.batchErrors}>
          {result.items
            .filter((item) => item.status === "FAILED")
            .map((item) => (
              <li key={item.rowNumber}>
                第 {item.rowNumber} 行：
                {item.error?.fields?.length
                  ? `${item.error.fields
                      .map(
                        (fieldKey) =>
                          schema.fields.find(
                            (field) => field.fieldKey === fieldKey,
                          )?.label ?? fieldKey,
                      )
                      .join("、")}：`
                  : ""}
                {item.error?.message ?? "导入失败"}
              </li>
            ))}
        </ul>
      ) : null}

      <Space>
        <Button
          type="primary"
          loading={save.isPending}
          disabled={
            !parsed ||
            mappedFields.length === 0 ||
            completedRows.size === parsed.rows.length
          }
          onClick={() => save.mutate()}
        >
          {completedRows.size > 0 ? "重试失败行" : "导入映射后的行"}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </Space>
    </Drawer>
  );
}
