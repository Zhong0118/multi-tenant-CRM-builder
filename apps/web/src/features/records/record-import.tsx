"use client";

import {
  Alert,
  Button,
  Drawer,
  Progress,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  FIELD_TYPE_LABELS,
  selectOptions,
  type PublishedFieldView,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import type { RecordApi, RecordImportResult } from "./record-api";
import {
  coerceImportValue,
  type CsvEncoding,
  suggestFieldKey,
  type ParsedCsv,
} from "./record-csv";

import {
  readImportFile,
  importBatchId,
  importFailureCsv,
  type ImportFile,
} from "./record-import-file";
import { runImportBatches, summarizeImport } from "./record-import-batches";

import styles from "./records.module.css";

const SKIP = "__skip__";

export interface RecordImportDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  api: RecordApi;
  canChooseOwner?: boolean;
  members?: DynamicFieldMember[];
  onClose: () => void;
  onCompleted: (result: RecordImportResult) => void;
}

export function RecordImportDrawer({
  tenantCode,
  schema,
  api,
  canChooseOwner = false,
  members = [],
  onClose,
  onCompleted,
}: RecordImportDrawerProps) {
  const importable = schema.fields.filter(
    (field) => field.access === "EDIT" && field.type !== "MEMBER",
  );
  const [ownerMemberId, setOwnerMemberId] = useState<string>();
  const [batchId, setBatchId] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [decodedEncoding, setDecodedEncoding] = useState<string>();
  const [importStarted, setImportStarted] = useState(false);
  const readRequest = useRef(0);
  const [source, setSource] = useState<ImportFile>();
  const [sheetName, setSheetName] = useState("");
  const [matchFields, setMatchFields] = useState<string[]>([]);
  const [busy, setBusy] = useState<"check" | "import">();
  const [loadingFile, setLoadingFile] = useState(false);
  const [checked, setChecked] = useState<RecordImportResult>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopped = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
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

  const completedRows = new Set(
    result?.items
      .filter((item) => item.status === "CREATED" || item.status === "SKIPPED")
      .map((item) => item.rowNumber),
  );
  const canCheck =
    !!parsed &&
    !!batchId &&
    mappedFields.length > 0 &&
    !duplicateFields.length &&
    !missingRequired.length &&
    completedRows.size < parsed.rows.length;
  const eligible =
    checked?.items.filter((item) => item.status !== "FAILED").length ?? 0;

  async function run(dryRun: boolean) {
    if (!parsed || !batchId || running.current) return;
    running.current = true;
    setBusy(dryRun ? "check" : "import");
    setSummary(undefined);
    if (!dryRun) setImportStarted(true);
    const rows = parsed.rows
      .map((row, index) => ({
        rowNumber: parsed.rowNumbers?.[index] ?? index + 2,
        values: Object.fromEntries(
          mappedFields.map(({ index: column, field }) => [
            field.fieldKey,
            coerceImportValue(
              field.type,
              row[column] ?? "",
              selectOptions(field),
            ),
          ]),
        ),
      }))
      .filter(
        (row) =>
          !completedRows.has(row.rowNumber) &&
          (dryRun ||
            checked?.items.some(
              (item) =>
                item.rowNumber === row.rowNumber && item.status !== "FAILED",
            )),
      );
    const merged = new Map(
      dryRun ? [] : result?.items.map((item) => [item.rowNumber, item]),
    );
    if (!dryRun)
      for (const item of checked?.items ?? [])
        if (item.status === "FAILED") merged.set(item.rowNumber, item);
    setProgress({ done: 0, total: rows.length });
    if (dryRun) setChecked(undefined);
    let done = 0;
    try {
      await runImportBatches({
        input: {
          batchId,
          dryRun,
          matchFields,
          rows,
          ...(canChooseOwner ? { ownerMemberId: ownerMemberId ?? null } : {}),
        },
        request: (input) =>
          api.importRows(tenantCode, schema.object.code, input),
        shouldStop: () => stopped.current,
        onBatch: (next) => {
          for (const item of next.items) merged.set(item.rowNumber, item);
          done += next.items.length;
          if (!stopped.current) {
            setProgress({ done, total: rows.length });
            if (!dryRun) setResult(summarizeImport([...merged.values()]));
          }
        },
      });
      if (!stopped.current && dryRun)
        setChecked(summarizeImport([...merged.values()]));
    } catch (caught) {
      if (!stopped.current)
        setSummary(
          `请求中断，已成功的行会保留。请重新检查剩余行后继续。${toApiError(caught).message}`,
        );
    } finally {
      running.current = false;
      if (!stopped.current) {
        setBusy(undefined);
        if (!dryRun) setChecked(undefined);
      }
      if (!dryRun) onCompleted(summarizeImport([...merged.values()]));
    }
  }

  function close() {
    stopped.current = true;
    ++readRequest.current;
    onClose();
  }

  async function selectSheet(
    nextSource: ImportFile,
    name: string,
    request: number,
  ) {
    const next = nextSource.sheet(name);
    const id = await importBatchId(nextSource.bytes, name);
    if (request !== readRequest.current || stopped.current) return;
    setSheetName(name);
    setBatchId(id);
    setParsed(next);
    setMapping(
      next.headers.map((header) => suggestFieldKey(header, importable) ?? SKIP),
    );
  }

  function resetResult() {
    setChecked(undefined);
    setResult(undefined);
    setSummary(undefined);
    setProgress({ done: 0, total: 0 });
  }

  async function onFile(file: File | undefined, nextEncoding: CsvEncoding) {
    const request = ++readRequest.current;
    setSelectedFile(file);
    setEncoding(nextEncoding);
    setDecodedEncoding(undefined);
    setImportStarted(false);
    setBatchId(undefined);
    setParseError(undefined);
    resetResult();
    setParsed(undefined);
    setSource(undefined);
    setMatchFields([]);
    setFileName(file?.name);
    if (!file) {
      setLoadingFile(false);
      return;
    }
    setLoadingFile(true);
    try {
      const nextSource = await readImportFile(file, nextEncoding);
      if (request !== readRequest.current || stopped.current) return;
      setSource(nextSource);
      setDecodedEncoding(nextSource.encoding);
      await selectSheet(nextSource, nextSource.sheetNames[0] ?? "", request);
    } catch (error) {
      if (request === readRequest.current && !stopped.current)
        showFileError(error);
    } finally {
      if (request === readRequest.current && !stopped.current)
        setLoadingFile(false);
    }
  }

  function showFileError(error: unknown) {
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
  }

  const displayedResult = checked ?? result;
  function downloadFailures() {
    if (!parsed || !displayedResult) return;
    const url = URL.createObjectURL(
      new Blob([importFailureCsv(parsed, displayedResult.items)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "导入失败明细.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Drawer
      open
      size={560}
      title="导入 Excel / CSV"
      aria-label="导入 Excel / CSV"
      onClose={close}
      destroyOnHidden
    >
      {parseError ? <Alert type="error" showIcon title={parseError} /> : null}
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      {result ? (
        <Alert
          type={result.failed ? "warning" : "success"}
          showIcon
          title={`成功 ${result.created} 行，跳过 ${result.skipped ?? 0} 行，失败 ${result.failed} 行。`}
        />
      ) : null}
      {checked ? (
        <Alert
          type={checked.failed ? "warning" : "info"}
          showIcon
          title={`检查完成：可新增 ${checked.items.filter((item) => item.status === "READY").length} 行，预计跳过 ${checked.skipped ?? 0} 行，错误 ${checked.failed} 行。检查尚未写入数据。`}
        />
      ) : null}
      <Typography.Paragraph type="secondary">
        支持 Excel（.xlsx / .xls）和 CSV，单个工作表最多 10000 行、40
        列，文件最大 10 MB。系统自动分批，无需手动拆成 500 行。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        按已发布字段导入，文件中的成员和负责人姓名不会自动绑定账号。单选填写已有选项名称，多选用分号分隔（如“重点；已联系”）。导入只新增，不覆盖现有记录。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        CSV 自动尝试 UTF-8、UTF-16 编码标记和 GBK /
        GB18030。编码无法保证完全识别，请核对预览，必要时手动切换。
      </Typography.Paragraph>
      {canChooseOwner ? (
        <label className={styles.columnChooserRow}>
          <span>导入负责人</span>
          <Select
            aria-label="导入负责人"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="未分配"
            value={ownerMemberId}
            disabled={!!busy || loadingFile || importStarted}
            options={members.map((member) => ({
              value: member.id,
              label: member.displayName ?? "未设置姓名",
            }))}
            onChange={(next?: string) => {
              setOwnerMemberId(next);
              resetResult();
            }}
          />
        </label>
      ) : null}
      <Typography.Paragraph type="secondary">
        {canChooseOwner
          ? "仅为本次新增记录分配负责人，并按业务表的回收期限计时；未选择则保持未分配。公共池关闭时暂停回收，跳过的重复记录保持原归属。"
          : "本次新增记录归你负责"}
      </Typography.Paragraph>
      <input
        type="file"
        disabled={!!busy || loadingFile}
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="选择 Excel 或 CSV 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file, "auto");
        }}
      />
      <label className={styles.columnChooserRow}>
        <span>文件编码</span>
        <Select
          aria-label="文件编码"
          value={encoding}
          disabled={
            !!busy ||
            loadingFile ||
            importStarted ||
            !!source?.sheetNames.length
          }
          onChange={(next: CsvEncoding) => void onFile(selectedFile, next)}
          options={[
            { value: "auto", label: "自动识别" },
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
          本批次已开始导入，负责人、编码、工作表和映射已锁定。同一账号重选原文件和工作表可继续，已成功的行会跳过。修改文件后请使用查重字段避免重复。
        </Typography.Paragraph>
      ) : null}
      {source?.sheetNames.length ? (
        <label className={styles.columnChooserRow}>
          <span>工作表</span>
          <Select
            aria-label="工作表"
            value={sheetName}
            disabled={!!busy || loadingFile || importStarted}
            options={source.sheetNames.map((name) => ({
              value: name,
              label: name,
            }))}
            onChange={async (name) => {
              const request = ++readRequest.current;
              setSheetName(name);
              setParsed(undefined);
              setBatchId(undefined);
              setParseError(undefined);
              setMatchFields([]);
              resetResult();
              setLoadingFile(true);
              try {
                await selectSheet(source, name, request);
              } catch (error) {
                if (request === readRequest.current && !stopped.current)
                  showFileError(error);
              } finally {
                if (request === readRequest.current && !stopped.current)
                  setLoadingFile(false);
              }
            }}
          />
        </label>
      ) : null}
      {loadingFile ? (
        <Typography.Paragraph>正在读取文件…</Typography.Paragraph>
      ) : null}
      {progress.total > 0 ? (
        <>
          <Progress
            percent={Math.round((progress.done / progress.total) * 100)}
            status={busy ? "active" : undefined}
          />
          <Typography.Paragraph>
            {busy === "check" ? "检查" : "处理"}进度：{progress.done} /{" "}
            {progress.total} 行
          </Typography.Paragraph>
        </>
      ) : null}
      <Typography.Paragraph type="secondary">
        关闭页面会停止后续批次，正在提交的批次可能完成。恢复时请使用同一账号重新选择原文件和工作表。
      </Typography.Paragraph>
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
                  disabled={!!busy || loadingFile || importStarted}
                  aria-label={`映射 ${header || `第 ${index + 1} 列`}`}
                  className={styles.importMap}
                  value={mapping[index]}
                  onChange={(next) => {
                    resetResult();
                    setMatchFields([]);
                    setMapping((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? next : value,
                      ),
                    );
                  }}
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
          <label className={styles.columnChooserRow}>
            <span>查重字段（可选，最多 3 个）</span>
            <Select
              mode="multiple"
              aria-label="查重字段"
              value={matchFields}
              maxCount={3}
              disabled={!!busy || loadingFile || importStarted}
              placeholder="选择手机号、编号等业务唯一标识"
              options={mappedFields
                .filter(({ field }) => field.type !== "MULTI_SELECT")
                .map(({ field }) => ({
                  value: field.fieldKey,
                  label: field.label,
                }))}
              onChange={(fields) => {
                setMatchFields(fields);
                resetResult();
              }}
            />
          </label>
          <Typography.Paragraph type="secondary">
            {matchFields.length
              ? "所选字段全部相同时跳过。查重字段不能为空；按当前账号可见的数据查重，文件内重复也会跳过。"
              : "未选择查重字段：只防止同一文件重复导入。不同文件的重复数据会新增，请选择能标识一条业务记录的字段。"}
          </Typography.Paragraph>
          <div style={{ overflowX: "auto" }}>
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
          </div>
        </>
      ) : null}

      {displayedResult && displayedResult.failed > 0 ? (
        <ul className={styles.batchErrors}>
          {displayedResult.items
            .filter((item) => item.status === "FAILED")
            .slice(0, 50)
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

      {displayedResult?.failed ? (
        <Button onClick={downloadFailures}>下载失败明细</Button>
      ) : null}
      {displayedResult && displayedResult.failed > 50 ? (
        <Typography.Paragraph>
          这里只展示前 50 个错误，完整结果请下载失败明细。
        </Typography.Paragraph>
      ) : null}
      <Space wrap>
        <Button
          aria-label={importStarted ? "检查剩余行" : "检查数据"}
          loading={busy === "check"}
          disabled={!canCheck || !!busy || loadingFile}
          onClick={() => void run(true)}
        >
          {importStarted ? "检查剩余行" : "检查数据"}
        </Button>
        {eligible > 0 ? (
          <Button
            type="primary"
            loading={busy === "import"}
            disabled={!!busy}
            onClick={() => void run(false)}
          >
            确认导入（{eligible} 行，含重复检查）
          </Button>
        ) : null}
        <Button onClick={close}>关闭</Button>
      </Space>
    </Drawer>
  );
}
