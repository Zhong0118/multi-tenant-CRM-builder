"use client";

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Tag,
  Drawer,
  Progress,
  Select,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  FIELD_TYPE_LABELS,
  type PublishedFieldView,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import type { DynamicFieldMember } from "./dynamic-field";
import type { RecordApi, RecordImportResult } from "./record-api";
import {
  inferImportDateOrder,
  type CsvEncoding,
  type ParsedCsv,
} from "./record-csv";

import {
  readImportFile,
  importBatchId,
  importFailureCsv,
  type ImportFile,
} from "./record-import-file";
import { summarizeImport } from "./record-import-batches";
import {
  IMPORT_MANUAL_SKIP,
  runGroupedImport,
  resolveImportOwners,
  type GroupedImportPlan,
  type ImportDestination,
} from "./record-import-groups";
import {
  SKIP,
  OWNER,
  APPEND,
  ownerHeader,
  initialMapping,
  buildImportRows,
} from "./record-import-mapping";
import { ImportOwners } from "./record-import-owners";
import importStyles from "./record-import.module.css";

import styles from "./records.module.css";

import { memberSelectOptions } from "@/components/identity/member-identity";

export interface RecordImportDrawerProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  api: RecordApi;
  timeZone?: string;
  canChooseOwner?: boolean;
  poolConfig?: import("./record-pool-types").RecordPoolConfig;
  members?: DynamicFieldMember[];
  onClose: () => void;
  onCompleted: (result: RecordImportResult) => void;
}

export function RecordImportDrawer({
  tenantCode,
  schema,
  api,
  timeZone,
  canChooseOwner = false,
  poolConfig,
  members = [],
  onClose,
  onCompleted,
}: RecordImportDrawerProps) {
  const importable = schema.fields.filter(
    (field) =>
      (field.access === "EDIT" || field.access === "CREATE_ONLY") &&
      !field.isSystem &&
      field.type !== "MEMBER",
  );
  const [ownerMemberId, setOwnerMemberId] = useState<string>();
  const [importToPool, setImportToPool] = useState(
    Boolean(
      canChooseOwner && poolConfig?.enabled && poolConfig.lifecycleEnabled,
    ),
  );
  const [batchId, setBatchId] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [decodedEncoding, setDecodedEncoding] = useState<string>();
  const [importStarted, setImportStarted] = useState(false);
  const readRequest = useRef(0);
  const [source, setSource] = useState<ImportFile>();
  const [sheetName, setSheetName] = useState("");
  const [selectedMatchFields, setMatchFields] = useState<string[]>([]);
  const [busy, setBusy] = useState<"check" | "import">();
  const [loadingFile, setLoadingFile] = useState(false);
  const [checkResult, setChecked] = useState<RecordImportResult>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopped = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedCsv>();
  const [mapping, setMapping] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string>();
  const [summary, setSummary] = useState<string>();
  const [result, setResult] = useState<RecordImportResult>();

  const [headerRow, setHeaderRow] = useState(1);
  const [headers, setHeaders] = useState<
    { rowNumber: number; cells: string[] }[]
  >([]);
  const [autoHeader, setAutoHeader] = useState(false);
  const [manual, setManual] = useState<number[]>([]);
  const [ownerChoices, setOwnerChoices] = useState<
    Map<string, ImportDestination>
  >(new Map());
  const [overrides, setOverrides] = useState<Record<number, "DMY" | "MDY">>({});
  const [readyPlan, setReadyPlan] = useState<
    GroupedImportPlan & { scope: string }
  >();
  const ownerColumn = canChooseOwner ? mapping.indexOf(OWNER) : -1;
  const owners = useMemo(
    () =>
      parsed && ownerColumn >= 0
        ? resolveImportOwners(
            parsed.rows.map((row) => row[ownerColumn] ?? ""),
            members,
          )
        : [],
    [parsed, ownerColumn, members],
  );
  const resolvedOwners = new Map<string, ImportDestination>();
  const poolEnabled = Boolean(
    poolConfig?.enabled && poolConfig.lifecycleEnabled,
  );
  const activeMembers = new Set(
    members.filter((m) => m.status !== "DISABLED").map((m) => m.id),
  );
  for (const entry of owners) {
    const choice =
      ownerChoices.get(entry.name) ??
      (entry.matches.length === 1
        ? { kind: "member" as const, id: entry.matches[0].id }
        : undefined);
    if (
      choice &&
      (choice.kind !== "pool" || poolEnabled) &&
      (choice.kind !== "member" || activeMembers.has(choice.id))
    )
      resolvedOwners.set(entry.name, choice);
  }
  const dateInferences = useMemo(
    () =>
      mapping.map((key, i) => {
        const type = schema.fields.find((f) => f.fieldKey === key)?.type;
        return parsed && (type === "DATE" || type === "DATETIME")
          ? inferImportDateOrder(parsed.rows.map((row) => row[i] ?? ""))
          : undefined;
      }),
    [mapping, parsed, schema.fields],
  );
  const dateOrders = Object.fromEntries(
    dateInferences.map((inf, i) => [
      i,
      overrides[i] ?? (inf === "DMY" || inf === "MDY" ? inf : undefined),
    ]),
  );
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

  const matchableFields = mappedFields.filter(
    ({ field }) =>
      field.type !== "MULTI_SELECT" &&
      (schema.queryFieldKeys === undefined ||
        schema.queryFieldKeys.includes(field.fieldKey)),
  );
  const matchFields = selectedMatchFields.filter((key) =>
    matchableFields.some(({ field }) => field.fieldKey === key),
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
      !mappedFields.some((item) => item.field.fieldKey === field.fieldKey) &&
      !mapping.includes(APPEND + field.fieldKey),
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
    (mappedFields.length > 0 ||
      mapping.some((key) => key.startsWith(APPEND))) &&
    resolvedOwners.size === owners.length &&
    !dateInferences.some((v, i) => v === "ambiguous" && !overrides[i]) &&
    !duplicateFields.length &&
    !missingRequired.length &&
    completedRows.size < parsed.rows.length;
  const mappingLocked =
    importStarted && (!result || completedRows.size === parsed?.rows.length);
  // A background refresh may revoke a field or change an auto-matched owner.
  const scope = JSON.stringify([
    tenantCode,
    schema.object.code,
    schema.publication.number,
    timeZone,
    canChooseOwner,
    importable.map((f) => [f.fieldKey, f.access]),
    matchFields,
    poolEnabled,
    Array.from(resolvedOwners),
  ]);
  const checked = readyPlan?.scope === scope ? checkResult : undefined;
  const eligible =
    checked?.items.filter((item) => item.status === "READY").length ?? 0;

  async function run(dryRun: boolean) {
    if (
      !parsed ||
      !batchId ||
      running.current ||
      (!dryRun && (!checked || !readyPlan || !eligible))
    )
      return;
    running.current = true;
    setBusy(dryRun ? "check" : "import");
    setSummary(undefined);
    if (!dryRun) setImportStarted(true);
    const plan: GroupedImportPlan = dryRun
      ? {
          batchId,
          matchFields,
          rows: buildImportRows({
            parsed,
            mapping,
            fields: importable,
            timeZone,
            dateOrders,
            destination: (row) => {
              if (!canChooseOwner) return { kind: "default" };
              if (ownerColumn >= 0)
                return resolvedOwners.get(row[ownerColumn] ?? "")!;
              if (importToPool && poolEnabled) return { kind: "pool" };
              return ownerMemberId
                ? { kind: "member", id: ownerMemberId }
                : { kind: "unassigned" };
            },
          }),
        }
      : readyPlan!;
    let latest = result ?? summarizeImport([]);
    if (dryRun) {
      setChecked(undefined);
      setReadyPlan(undefined);
    }
    setProgress({ done: 0, total: plan.rows.length });
    try {
      const next = await runGroupedImport({
        plan,
        checked: dryRun ? undefined : checked,
        previousCreated: result?.items.filter(
          (item) => item.status === "CREATED",
        ),
        request: (input) =>
          api.importRows(tenantCode, schema.object.code, input),
        shouldStop: () => stopped.current,
        onProgress: (partial, done, total) => {
          if (!dryRun) latest = partial;
          if (stopped.current) return;
          setProgress({ done, total });
          if (!dryRun) setResult(partial);
        },
      });
      if (!stopped.current) {
        if (dryRun) {
          setChecked(next);
          setReadyPlan({ ...plan, scope });
        } else {
          latest = next;
          setResult(next);
        }
      }
    } catch (caught) {
      if (!stopped.current) {
        const error = toApiError(caught);
        if (error.status >= 400 && error.status < 500) {
          const created = dryRun ? (result?.created ?? 0) : latest.created;
          const ownerHint =
            error.code === "OWNER_INVALID"
              ? "请更换负责人，或由管理员确认该成员处于启用状态，且读取、修改权限已生效。"
              : "";
          setSummary(
            `${dryRun ? "检查未通过" : "导入未完成"}：${error.message}${ownerHint}${created > 0 ? `已成功导入 ${created} 行，数据已保留。` : ""}请处理以上问题后重新检查${importStarted || !dryRun ? "剩余行" : "数据"}。`,
          );
        } else {
          setSummary(
            `${dryRun ? "检查请求中断，本次检查不会写入数据，请重新检查。" : "请求中断，未收到结果的行待重查。请重新检查剩余行后继续。"}${error.message}`,
          );
        }
      }
    } finally {
      running.current = false;
      if (!stopped.current) {
        setBusy(undefined);
        if (!dryRun) setChecked(undefined);
      }
      if (!dryRun) onCompleted(latest);
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
    const selection = nextSource.headerSelection(name, importable);
    const id = await importBatchId(nextSource.bytes, name);
    if (request !== readRequest.current || stopped.current) return;
    setSheetName(name);
    setBatchId(id);
    setHeaders(selection.candidates);
    applyHeader(nextSource, name, selection.headerRow, selection.detected);
  }
  function applyHeader(
    file: ImportFile,
    name: string,
    row: number,
    automatic: boolean,
  ) {
    setHeaderRow(row);
    setAutoHeader(automatic);
    setParseError(undefined);
    setParsed(undefined);
    setManual([]);
    setOwnerChoices(new Map());
    setOverrides({});
    setMatchFields([]);
    resetResult();
    try {
      const next = file.sheet(name, row);
      setParsed(next);
      setMapping(initialMapping(next.headers, importable, canChooseOwner));
    } catch (err) {
      showFileError(err);
    }
  }
  function resetResult(keepCreated = false) {
    setReadyPlan(undefined);
    setChecked(undefined);
    setResult((previous) =>
      keepCreated && previous
        ? summarizeImport(previous.items.filter((i) => i.status === "CREATED"))
        : undefined,
    );
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
    setHeaders([]);
    setMatchFields([]);
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
      footer={
        <div className={importStyles.footer}>
          {checked && (
            <span role="status">
              已检查 {checked.items.length} 行 · 可导入 {eligible} ·
              重复或已导入{" "}
              {(checked.skipped ?? 0) -
                checked.items.filter((i) => i.reason === IMPORT_MANUAL_SKIP)
                  .length}{" "}
              · 主动跳过{" "}
              {
                checked.items.filter((i) => i.reason === IMPORT_MANUAL_SKIP)
                  .length
              }{" "}
              · 错误 {checked.failed}
            </span>
          )}
          <Button onClick={close}>关闭</Button>
          <Button
            type={eligible > 0 ? "default" : "primary"}
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
              确认导入 {eligible} 行
            </Button>
          ) : null}
        </div>
      }
      open
      size="min(100vw, clamp(720px, 64vw, 920px))"
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
      <Typography.Paragraph type="secondary">
        单个工作表最多 1 万行、40 列，文件最大 10 MB。请先核对对照，再检查数据。
      </Typography.Paragraph>
      {canChooseOwner &&
      ownerColumn < 0 &&
      poolConfig?.enabled &&
      poolConfig.lifecycleEnabled ? (
        <Checkbox
          aria-label="确认导入到初始公共池"
          checked={importToPool}
          disabled={!!busy || loadingFile || mappingLocked}
          onChange={(event) => {
            setImportToPool(event.target.checked);
            setOwnerMemberId(undefined);
            resetResult(importStarted);
          }}
        >
          确认导入到{poolConfig.labels?.leadPool ?? "初始公共池"}
          ，允许有权限成员领取
        </Checkbox>
      ) : null}
      {canChooseOwner && ownerColumn < 0 ? (
        <label className={styles.columnChooserRow}>
          <span>导入负责人</span>
          <Select
            aria-label="导入负责人"
            allowClear
            showSearch
            optionFilterProp="searchText"
            placeholder="未分配"
            value={ownerMemberId}
            disabled={!!busy || loadingFile || mappingLocked}
            options={memberSelectOptions(members)}
            onChange={(next?: string) => {
              setOwnerMemberId(next);
              if (next) setImportToPool(false);
              resetResult(importStarted);
            }}
          />
        </label>
      ) : null}
      <Typography.Paragraph type="secondary">
        {ownerColumn >= 0
          ? "新增记录按文件中的负责人分别归属"
          : importToPool
            ? "新记录进入初始公共池，允许有权限成员领取"
            : canChooseOwner
              ? "整批新增记录使用所选负责人"
              : "本次新增记录归你负责"}
      </Typography.Paragraph>
      <Button
        type="dashed"
        block
        className={importStyles.filePicker}
        disabled={!!busy || loadingFile}
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file && !busy && !loadingFile) void onFile(file, "auto");
        }}
      >
        {selectedFile ? (
          <>
            <strong>{selectedFile.name}</strong>
            {parsed && (
              <span>
                {parsed.rows.length} 行 · {parsed.headers.length} 列
              </span>
            )}
            <span>重新选择</span>
          </>
        ) : (
          "选择或拖入 Excel / CSV 文件"
        )}
      </Button>
      <input
        ref={fileInput}
        hidden
        type="file"
        disabled={!!busy || loadingFile}
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="选择 Excel 或 CSV 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file, "auto");
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
          本批次已开始导入。已成功的行保留原归属，剩余行修改后须重新检查。重试请使用原文件和同一工作表。
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
      {source && headers.length > 0 && (
        <label className={styles.columnChooserRow}>
          <span>表头在第几行</span>
          <Select
            aria-label="表头在第几行"
            value={headerRow}
            disabled={!!busy || loadingFile || importStarted}
            options={headers.map((h) => ({
              value: h.rowNumber,
              label: `第 ${h.rowNumber} 行 · ${h.cells.filter(Boolean).slice(0, 4).join(" / ").slice(0, 70)}`,
            }))}
            onChange={(row) => applyHeader(source, sheetName, row, false)}
          />
        </label>
      )}
      {autoHeader && headerRow > 1 && (
        <Typography.Text type="secondary">
          已识别第 {headerRow} 行为表头，可手动调整
        </Typography.Text>
      )}
      {loadingFile ? (
        <Typography.Paragraph>正在读取文件…</Typography.Paragraph>
      ) : null}
      {busy && progress.total > 0 ? (
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

      {parsed ? (
        <>
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
          <div className={importStyles.mapping} aria-label="文件列对照">
            {parsed.headers.map((header, index) => {
              const label = header || `第 ${index + 1} 列`;
              const lockedOwner = !canChooseOwner && ownerHeader(header);
              return (
                <div key={index} className={importStyles.row}>
                  <div>
                    <strong>{label}</strong>
                    <div className={importStyles.example}>
                      {parsed.rows
                        .slice(0, 3)
                        .map((row) => row[index])
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div>
                    <Select
                      disabled={
                        lockedOwner || !!busy || loadingFile || mappingLocked
                      }
                      id={`import-map-${index}`}
                      aria-label={`映射 ${label}`}
                      value={mapping[index]}
                      onChange={(next) => {
                        resetResult(importStarted);
                        setMatchFields([]);
                        setManual((prev) =>
                          prev.includes(index) ? prev : [...prev, index],
                        );
                        setOverrides((prev) => {
                          const next = { ...prev };
                          delete next[index];
                          return next;
                        });
                        if (next === OWNER || mapping[index] === OWNER)
                          setOwnerChoices(new Map());
                        setMapping((current) =>
                          current.map((old, i) => (i === index ? next : old)),
                        );
                      }}
                      options={[
                        { value: SKIP, label: "跳过此列" },
                        ...(canChooseOwner
                          ? [
                              {
                                value: OWNER,
                                label: "按行指定负责人",
                                disabled:
                                  ownerColumn >= 0 && ownerColumn !== index,
                              },
                            ]
                          : []),
                        ...importable.map((field) => ({
                          value: field.fieldKey,
                          label: `${field.label} · ${FIELD_TYPE_LABELS[field.type]}${importable.some((other) => other.fieldKey !== field.fieldKey && other.label === field.label) ? `（${field.fieldKey}）` : ""}${field.required ? "（必填）" : ""}`,
                        })),
                        ...importable
                          .filter((f) => f.type === "TEXTAREA")
                          .map((f) => ({
                            value: APPEND + f.fieldKey,
                            label: `追加到「${f.label}」`,
                          })),
                      ]}
                    />
                    {lockedOwner && <small>仅公司管理员可按行指定负责人</small>}
                    {dateInferences[index] === "conflict" ? (
                      <small>同一列的日期顺序冲突，请更正文件后重选</small>
                    ) : (
                      dateInferences[index] && (
                        <Select
                          aria-label={`日期顺序 ${label}`}
                          placeholder="请选择日月顺序"
                          value={dateOrders[index]}
                          disabled={!!busy || mappingLocked}
                          options={[
                            { value: "DMY", label: "日/月/年" },
                            { value: "MDY", label: "月/日/年" },
                          ]}
                          onChange={(order) => {
                            setOverrides((prev) => ({
                              ...prev,
                              [index]: order,
                            }));
                            resetResult(importStarted);
                          }}
                        />
                      )
                    )}
                  </div>
                  <Tag>
                    {manual.includes(index)
                      ? "手动"
                      : mapping[index] === SKIP
                        ? "未对照"
                        : "自动"}
                  </Tag>
                </div>
              );
            })}
          </div>
          {ownerColumn >= 0 && (
            <Collapse
              items={[
                {
                  key: "owners",
                  label: `查看负责人对照 · ${owners.length} 个姓名 · ${owners.length - resolvedOwners.size} 个待处理`,
                  children: (
                    <ImportOwners
                      owners={owners}
                      members={members}
                      resolved={resolvedOwners}
                      disabled={!!busy || mappingLocked}
                      poolEnabled={poolEnabled}
                      onChange={(name, dest) => {
                        setOwnerChoices((prev) =>
                          new Map(prev).set(name, dest),
                        );
                        resetResult(importStarted);
                      }}
                    />
                  ),
                },
              ]}
            />
          )}
          <label className={styles.columnChooserRow}>
            <span>查重字段（可选，最多 3 个）</span>
            <Select
              mode="multiple"
              aria-label="查重字段"
              value={matchFields}
              maxCount={3}
              disabled={!!busy || loadingFile || mappingLocked}
              placeholder="选择手机号、编号等业务唯一标识"
              options={matchableFields.map(({ field }) => ({
                value: field.fieldKey,
                label: field.label,
              }))}
              onChange={(fields) => {
                setMatchFields(fields);
                resetResult(importStarted);
              }}
            />
          </label>
          <Typography.Paragraph type="secondary">
            {matchFields.length
              ? "所选字段全部相同时跳过。查重字段不能为空；按当前账号可见的数据查重，文件内重复也会跳过。"
              : "未选择查重字段：只防止同一文件重复导入。不同文件的重复数据会新增，请选择能标识一条业务记录的字段。"}
          </Typography.Paragraph>
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
    </Drawer>
  );
}
