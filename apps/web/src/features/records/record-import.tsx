"use client";

import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Drawer, Select, Space, Typography } from "antd";
import { useMemo, useRef, useState } from "react";

import {
  FIELD_TYPE_LABELS,
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
  decodeRecordCsv,
  type CsvEncoding,
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
  const [selectedFile, setSelectedFile] = useState<File>();
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [decodedEncoding, setDecodedEncoding] = useState<string>();
  const [importStarted, setImportStarted] = useState(false);
  const readRequest = useRef(0);
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

  const duplicateFields = mappedFields.filter(
    (item, index) =>
      mappedFields.findIndex(
        (other) => other.field.fieldKey === item.field.fieldKey,
      ) !== index,
  );
  const missingRequired = importable.filter(
    (field) =>
      field.required &&
      field.defaultValue == null &&
      !mappedFields.some((item) => item.field.fieldKey === field.fieldKey),
  );
  const skippedColumns =
    parsed?.headers.filter((_, index) => mapping[index] === SKIP) ?? [];

  const save = useMutation({
    mutationFn: () => {
      if (!parsed || duplicateFields.length || missingRequired.length)
        throw new Error("invalid csv mapping");
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

  async function onFile(file: File | undefined, nextEncoding: CsvEncoding) {
    const request = ++readRequest.current;
    setSelectedFile(file);
    setEncoding(nextEncoding);
    setDecodedEncoding(undefined);
    setImportStarted(false);
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
    let next: ParsedCsv;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (request !== readRequest.current) return;
      const decoded = decodeRecordCsv(bytes, nextEncoding);
      setDecodedEncoding(decoded.encoding);
      next = parseCsv(decoded.text, { strictColumnCount: true });
    } catch (error) {
      if (request !== readRequest.current) return;
      const message = error instanceof Error ? error.message : "";
      setParseError(
        message === "CSV_UNCLOSED_QUOTE"
          ? "CSV 引号未闭合，请检查文件。"
          : message === "名单列数与表头不一致"
            ? "数据列数超过表头，请检查分隔符；含逗号的单元格需要用双引号包围。"
            : error instanceof TypeError || error instanceof DOMException
              ? "文件读取失败，请重新选择文件。"
              : message || "文件读取失败，请重新选择文件。",
      );
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
        支持 CSV，每次最多 500 行、40 列。Excel（.xlsx / .xls）请另存为 CSV
        UTF-8，不能直接修改后缀。
        按当前已发布字段匹配，每列可映射到一个可写字段或跳过。成员字段及负责人不能通过姓名导入。成功行立即写入，失败行单独列出。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        单选填写已有选项名称，多选用中文分号分隔（如“重点；已联系”）。未知选项不会自动新增。导入会新增记录，不会按姓名自动覆盖已有数据。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        自动模式识别 UTF-8 或带编码标记的 UTF-16。旧版 Excel 导出的中文 CSV
        可尝试 GBK / GB18030；请确认预览中文字正常后再导入。
      </Typography.Paragraph>

      <input
        type="file"
        disabled={save.isPending}
        accept=".csv,text/csv"
        aria-label="选择 CSV 文件"
        onChange={(event) => void onFile(event.target.files?.[0], "auto")}
      />
      <label className={styles.columnChooserRow}>
        <span>文件编码</span>
        <Select
          aria-label="文件编码"
          value={encoding}
          disabled={save.isPending || importStarted}
          onChange={(next: CsvEncoding) => void onFile(selectedFile, next)}
          options={[
            { value: "auto", label: "自动（UTF-8 / Unicode 标记）" },
            { value: "utf-8", label: "UTF-8" },
            { value: "gb18030", label: "GBK / GB18030（中文 Windows）" },
          ]}
        />
      </label>
      {decodedEncoding ? (
        <Typography.Paragraph>
          当前按 {decodedEncoding} 读取
        </Typography.Paragraph>
      ) : null}
      {importStarted ? (
        <Typography.Paragraph type="secondary">
          本批次已开始导入，编码已锁定；重试只提交未成功的行。重选文件会建立新批次，可能重复新增已导入的记录。
        </Typography.Paragraph>
      ) : null}
      {fileName ? (
        <Typography.Paragraph>{fileName}</Typography.Paragraph>
      ) : null}

      {parsed ? (
        <>
          <Typography.Paragraph>
            {parsed.rows.length} 行 · {parsed.headers.length} 列
          </Typography.Paragraph>
          {duplicateFields.length ? (
            <Alert
              type="error"
              showIcon
              title={`多个文件列映射到了同一字段：${[...new Set(duplicateFields.map((item) => item.field.label))].join("、")}。请保留一列，其余改为跳过。`}
            />
          ) : null}
          {missingRequired.length ? (
            <Alert
              type="error"
              showIcon
              title={`尚未映射必填字段：${missingRequired.map((field) => field.label).join("、")}。请先选择对应列。`}
            />
          ) : null}
          {skippedColumns.length ? (
            <Alert
              type="warning"
              showIcon
              title={`将跳过 ${skippedColumns.length} 列：${skippedColumns.map((header) => header || "空表头").join("、")}。未匹配或同名字段不会自动选择，请核对后手动映射需要导入的列。`}
            />
          ) : null}
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
                      label: `${field.label} · ${FIELD_TYPE_LABELS[field.type]}${importable.some((other) => other.fieldKey !== field.fieldKey && other.label === field.label) ? `（${field.fieldKey}）` : ""}${field.required ? "（必填）" : ""}`,
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
            duplicateFields.length > 0 ||
            missingRequired.length > 0 ||
            completedRows.size === parsed.rows.length
          }
          onClick={() => {
            setImportStarted(true);
            save.mutate();
          }}
        >
          {completedRows.size > 0 ? "重试失败行" : "导入映射后的行"}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </Space>
    </Drawer>
  );
}
