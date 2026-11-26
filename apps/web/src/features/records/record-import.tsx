"use client";

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Drawer,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Tooltip,
  Typography,
} from "antd";
import { InboxOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { AiBadge } from "@/components/ai/ai-badge";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
  importRowError,
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
import { ImportCheckPreview } from "./record-import-preview";
import importStyles from "./record-import.module.css";

import styles from "./records.module.css";

import { memberSelectOptions } from "@/components/identity/member-identity";

import type { ImportAssistPlan } from "@crm/contracts";
import { ImportValues } from "./record-import-values";
import { requestImportAssist } from "./record-import-assist-api";
import {
  buildImportHeaderEvidence,
  buildImportPreview,
  applyImportAdvice,
  reviewImportPlan,
  importableField,
  isOptionField,
  type AssistDraft,
  type ImportPreview,
  type AdoptChoice,
} from "./record-import-assist";

// Byte identity survives renames, sheet changes and reopening the drawer.
const attemptedFiles = new Set<string>();
type AssistSnapshot = {
  scope: string;
  draft: AssistDraft;
  headerRow: number;
  autoHeader: boolean;
  headerLocked: boolean;
  ownerChoices: Map<string, ImportDestination>;
  ownerMemberId?: string;
  importToPool: boolean;
  excluded: number[];
};
type Generated = {
  plan: ImportAssistPlan;
  preview: ImportPreview;
  scope: string;
};
export interface RecordImportDrawerProps {
  assistEnabled?: boolean;
  memberKey?: string | null;
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
  assistEnabled = false,
  memberKey,
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
  const importable = useMemo(
    () => schema.fields.filter(importableField),
    [schema.fields],
  );
  const [evidence, setEvidence] = useState<{
    parsed: ParsedCsv;
    hashes: string[];
  }>();
  const [fileKey, setFileKey] = useState("");
  const [headerLocked, setHeaderLocked] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [amountUnits, setAmountUnits] = useState<AssistDraft["amountUnits"]>(
    {},
  );
  const [valueChoices, setValueChoices] = useState<AssistDraft["valueChoices"]>(
    {},
  );
  const [adoptedColumns, setAdoptedColumns] = useState<string[]>([]);
  const [generated, setGenerated] = useState<Generated>();
  // Which columns AI set, and to what — kept after later hand edits so the
  // status column still tells AI picks from rule matches.
  const [aiMapped, setAiMapped] = useState<{
    scope: string;
    keys: Record<number, string>;
  }>();
  const [snapshot, setSnapshot] = useState<AssistSnapshot>();
  const [draftChanged, setDraftChanged] = useState(false);
  const [started, setStarted] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  const [aiNotice, setAiNotice] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [featureDenied, setFeatureDenied] = useState(false);
  const assistScope = JSON.stringify([
    tenantCode,
    memberKey,
    schema.object.code,
    schema.publication.number,
    schema.fields,
    schema.queryFieldKeys,
    assistEnabled,
    canChooseOwner,
  ]);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => {
      if (controller.current) {
        controller.current.abort();
        controller.current = null;
        setStarted(undefined);
      }
    },
    [assistScope],
  );
  useEffect(() => {
    if (started === undefined) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [started]);
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
  const [matchLocked, setMatchLocked] = useState(false);
  const [selectedMatchFields, setMatchFields] = useState<string[]>([]);
  const [busy, setBusy] = useState<"check" | "import">();
  const [loadingFile, setLoadingFile] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  const sheetSummary = useMemo(() => {
    if (!parsed) return;
    const occurrences = new Map<string, number>();
    const samples = parsed.headers.map(() => new Set<string>());
    for (const row of parsed.rows) {
      const key = JSON.stringify(row);
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      row.forEach((value, column) => {
        if (value && samples[column].size < 3) samples[column].add(value);
      });
    }
    let duplicateRows = 0;
    for (const count of occurrences.values()) {
      if (count > 1) duplicateRows += count;
    }
    return {
      duplicateRows,
      samples: samples.map((values) => [...values].join(" · ")),
    };
  }, [parsed]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string>();
  const [summary, setSummary] = useState<string>();
  const [result, setResult] = useState<RecordImportResult>();

  const [headerRow, setHeaderRow] = useState(1);
  const [headers, setHeaders] = useState<
    { rowNumber: number; cells: string[] }[]
  >([]);
  const [autoHeader, setAutoHeader] = useState(false);
  // A confidently found header row hides its picker until asked for.
  const [pickHeader, setPickHeader] = useState(false);
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
  // A skipped column whose every name is one member — often titled 销售 or
  // 归属, which are too ambiguous to map on their own.
  const ownerCandidate = (() => {
    if (!canChooseOwner || !parsed || ownerColumn >= 0) return undefined;
    for (const [index, header] of parsed.headers.entries()) {
      if (mapping[index] !== SKIP) continue;
      const names = parsed.rows
        .map((row) => (row[index] ?? "").trim())
        .filter(Boolean);
      if (
        names.length &&
        resolveImportOwners(names, members).every(
          (entry) => entry.matches.length === 1,
        )
      )
        return { index, header: header.trim() || `第 ${index + 1} 列` };
    }
  })();
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

  const recommendedMatch = matchableFields.find(
    ({ field }) => field.type === "PHONE" || /编号|编码/.test(field.label),
  )?.field;
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
  const completedRows = new Set(
    result?.items
      .filter((item) => item.status === "CREATED" || item.status === "SKIPPED")
      .map((item) => item.rowNumber),
  );
  const canCheck =
    !revoked &&
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
  const unassigned =
    canChooseOwner &&
    ownerColumn < 0 &&
    !(importToPool && poolEnabled) &&
    !ownerMemberId;
  const emptyMarkerCount = checked
    ? readyPlan!.rows.reduce((n, row) => n + (row.emptyMarkerCount ?? 0), 0)
    : 0;
  const eligible =
    checked?.items.filter((item) => item.status === "READY").length ?? 0;
  const manualSkipCount =
    checked?.items.filter((item) => item.reason === IMPORT_MANUAL_SKIP)
      .length ?? 0;
  const duplicateCount = (checked?.skipped ?? 0) - manualSkipCount;
  const allDone = Boolean(
    importStarted && parsed && completedRows.size === parsed.rows.length,
  );
  // A new verdict lands below the fold: bring it into view.
  const verdictRef = useRef<HTMLElement>(null);
  useEffect(() => {
    verdictRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [checked, result]);

  async function run(dryRun: boolean) {
    if (
      revoked ||
      controller.current ||
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
            amountUnits,
            valueChoices,
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
        if (
          error.status === 403 &&
          ["OBJECT_ACTION_FORBIDDEN", "WORKSPACE_FORBIDDEN"].includes(
            error.code,
          )
        )
          setRevoked(true);
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
    controller.current?.abort();
    onClose();
  }
  // Esc, the mask and × land here: a chosen file and its column matches are
  // asked about before they are thrown away.
  const [modal, modalHolder] = Modal.useModal();
  const asking = useRef(false);
  function requestClose() {
    const unsaved = !!parsed && !allDone && !revoked;
    if (!unsaved) return close();
    if (asking.current) return;
    asking.current = true;
    const left = parsed.rows.length - completedRows.size;
    void modal.confirm({
      title: importStarted ? "停止导入并关闭？" : "放弃这次导入？",
      content: importStarted
        ? `已导入的行会保留，剩下 ${left} 行没有导入。`
        : "已选的文件和列对照还没有导入，关闭后需要重新选择。",
      okText: importStarted ? "关闭" : "放弃",
      okButtonProps: { danger: true },
      autoFocusButton: "cancel",
      cancelText: "继续导入",
      onOk: close,
      afterClose: () => {
        asking.current = false;
      },
    });
  }

  async function selectSheet(
    nextSource: ImportFile,
    name: string,
    request: number,
  ) {
    const selection = nextSource.headerSelection(name, importable);
    const [id, identity] = await Promise.all([
      importBatchId(nextSource.bytes, name),
      importBatchId(nextSource.bytes, ""),
    ]);

    if (request !== readRequest.current || stopped.current) return;
    setSheetName(name);
    setBatchId(id);
    const attemptKey = JSON.stringify([tenantCode, memberKey, identity]);
    try {
      if (sessionStorage.getItem("crm.importAssist." + attemptKey))
        attemptedFiles.add(attemptKey);
    } catch {
      /* Storage can be disabled in an embedded browser. */
    }
    setFileKey(attemptKey);
    setHeaderLocked(selection.detected);
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
    setAmountUnits({});
    setValueChoices({});
    setAutoHeader(automatic);
    setParseError(undefined);
    setParsed(undefined);
    setMapping([]);
    setManual([]);
    setMatchLocked(false);
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
  function clearCheck(keepCreated = false) {
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

  function cancelAssist(message = "") {
    controller.current?.abort();
    controller.current = null;
    setStarted(undefined);
    setAiNotice(message);
  }
  function resetResult(keepCreated = false) {
    if (controller.current) cancelAssist("草稿已更改，请手动核对");
    if (snapshot) setDraftChanged(true);
    setGenerated(undefined);
    clearCheck(keepCreated);
  }
  function newSelection() {
    cancelAssist();
    setAiMapped(undefined);
    setSnapshot(undefined);
    setDraftChanged(false);
    setExcluded([]);
    setGenerated(undefined);
  }
  const draft = useMemo<AssistDraft>(
    () => ({
      mapping,
      manual,
      matchFields: selectedMatchFields,
      matchLocked,
      dateOrders: overrides,
      amountUnits,
      valueChoices,
    }),
    [
      mapping,
      manual,
      selectedMatchFields,
      matchLocked,
      overrides,
      amountUnits,
      valueChoices,
    ],
  );
  useEffect(() => {
    if (!source || !parsed || !assistEnabled) return;
    let active = true;
    void buildImportHeaderEvidence(source, sheetName, headerRow)
      .then((hashes) => {
        if (active) setEvidence({ parsed, hashes });
      })
      .catch(() => {
        if (active) setEvidence(undefined);
      });
    return () => {
      active = false;
    };
  }, [source, sheetName, headerRow, parsed, assistEnabled]);
  const preview = useMemo(
    () =>
      source &&
      assistEnabled &&
      !featureDenied &&
      !revoked &&
      batchId &&
      !loadingFile &&
      !importStarted &&
      evidence &&
      evidence.parsed === parsed
        ? buildImportPreview({
            headerEvidence: evidence.hashes,
            file: source,
            sheet: sheetName,
            headerRow,
            fields: schema.fields,
            draft,
            excluded,
            admin: canChooseOwner,
          })
        : undefined,
    [
      source,
      assistEnabled,
      featureDenied,
      revoked,
      batchId,
      loadingFile,
      importStarted,
      evidence,
      sheetName,
      headerRow,
      parsed,
      schema.fields,
      draft,
      excluded,
      canChooseOwner,
    ],
  );
  const attempted = attemptedFiles.has(fileKey);
  const current =
    generated?.scope === assistScope && assistEnabled && !importStarted
      ? generated
      : undefined;
  // Once rows are in, the AI plan can no longer be acted on, but the status
  // column still says where each mapping came from.
  const origin =
    generated?.scope === assistScope && assistEnabled ? generated : undefined;
  function markAi(next: AssistDraft, plan: ImportAssistPlan, merge: boolean) {
    const keys: Record<number, string> = {};
    for (const advice of plan.columns) {
      const target = advice.target;
      if (target.mode === "skip") continue;
      const index = Number(advice.col.slice(1)) - 1;
      const key =
        target.mode === "append" ? APPEND + target.field : target.field;
      if (next.mapping[index] === key) keys[index] = key;
    }
    setAiMapped((previous) => ({
      scope: assistScope,
      keys:
        merge && previous?.scope === assistScope
          ? { ...previous.keys, ...keys }
          : keys,
    }));
  }
  function install(next: AssistDraft) {
    setMapping(next.mapping);
    setManual(next.manual);
    setOverrides(next.dateOrders);
    setValueChoices(next.valueChoices);
    setAmountUnits(next.amountUnits);
    setMatchFields(next.matchFields);
    setMatchLocked(!!next.matchLocked);
    clearCheck();
  }
  async function generate() {
    if (
      !source ||
      !preview?.needed ||
      !fileKey ||
      attemptedFiles.has(fileKey) ||
      busy ||
      !assistEnabled ||
      featureDenied ||
      revoked ||
      importStarted
    )
      return;
    attemptedFiles.add(fileKey);
    try {
      sessionStorage.setItem("crm.importAssist." + fileKey, "1");
    } catch {
      /* The in-memory reservation still covers this page. */
    }
    const abort = new AbortController();
    controller.current = abort;
    const before = {
      scope: assistScope,
      draft,
      headerRow,
      autoHeader,
      headerLocked,
      ownerChoices,
      ownerMemberId,
      importToPool,
      excluded,
    };
    setAdoptedColumns([]);
    setAiNotice("");
    setElapsed(0);
    setStarted(Date.now());
    clearCheck();
    try {
      const response = await requestImportAssist(
        tenantCode,
        schema.object.code,
        preview.request,
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        stopped.current
      )
        return;
      const plan = reviewImportPlan(
        response,
        preview,
        source,
        sheetName,
        schema.fields,
        timeZone,
      );
      setGenerated({ plan, preview, scope: assistScope });
      setSnapshot(before);
      setDraftChanged(false);
      const next = applyImportAdvice(
        draft,
        preview,
        plan,
        schema.fields,
        undefined,
        schema.queryFieldKeys,
      );
      markAi(next, plan, false);
      install(next);
    } catch (e) {
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        stopped.current
      )
        return;
      const error = toApiError(e);
      if (error.code === "AI_PROVIDER_TIMEOUT") {
        attemptedFiles.delete(fileKey);
        try {
          sessionStorage.removeItem("crm.importAssist." + fileKey);
        } catch {
          /* In-memory tracking still allows a manual retry. */
        }
        setAiNotice("AI 这次没来得及给出建议，可以手动对照或再试一次");
        return;
      }
      if (error.status === 403) {
        if (
          ["OBJECT_ACTION_FORBIDDEN", "WORKSPACE_FORBIDDEN"].includes(
            error.code,
          )
        )
          setRevoked(true);
        else setFeatureDenied(true);
      }
      setAiNotice(error.message + " 手动对照已保留");
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setStarted(undefined);
      }
    }
  }
  function adopt(choice?: AdoptChoice) {
    if (!current || !source || busy || revoked || importStarted) return;
    if (choice && !choice.value)
      setAdoptedColumns((cols) => [...cols, choice.column]);
    const next = applyImportAdvice(
      draft,
      current.preview,
      current.plan,
      schema.fields,
      choice,
      schema.queryFieldKeys,
    );
    markAi(next, current.plan, true);
    install(next);
  }
  function remap(index: number, next: string) {
    resetResult(importStarted);
    setMatchFields([]);
    setAmountUnits((prev) => {
      const n = { ...prev };
      delete n[index];
      return n;
    });
    setValueChoices((prev) => {
      const n = { ...prev };
      delete n[index];
      return n;
    });
    setManual((prev) => (prev.includes(index) ? prev : [...prev, index]));
    setOverrides((prev) => {
      const n = { ...prev };
      delete n[index];
      return n;
    });
    if (next === OWNER || mapping[index] === OWNER) setOwnerChoices(new Map());
    setMapping((current) =>
      current.map((old, i) => (i === index ? next : old)),
    );
  }
  function restore() {
    if (
      !snapshot ||
      snapshot.scope !== assistScope ||
      !source ||
      busy ||
      importStarted
    )
      return;
    applyHeader(source, sheetName, snapshot.headerRow, snapshot.autoHeader);
    setHeaderLocked(snapshot.headerLocked);
    setOwnerChoices(snapshot.ownerChoices);
    setOwnerMemberId(snapshot.ownerMemberId);
    setImportToPool(snapshot.importToPool);
    setExcluded(snapshot.excluded);
    install(snapshot.draft);
    setSnapshot(undefined);
    setGenerated(undefined);
    setAiMapped(undefined);
    setAiNotice("已恢复到 AI 之前的对照");
  }
  async function onFile(file: File | undefined, nextEncoding: CsvEncoding) {
    const request = ++readRequest.current;
    newSelection();
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
      new Blob(
        [importFailureCsv(parsed, displayedResult.items, schema.fields)],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "导入失败明细.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (revoked)
    return (
      <Drawer
        open
        title="导入 Excel / CSV"
        onClose={close}
        footer={<Button onClick={close}>关闭</Button>}
      >
        <Alert
          type="error"
          showIcon
          title="当前已无导入权限，请关闭抽屉"
          description={summary}
        />
      </Drawer>
    );
  return (
    <Drawer
      footer={
        <div className={importStyles.footer}>
          {emptyMarkerCount > 0 && (
            <span>已把 {emptyMarkerCount} 格 NaN/#N/A 按空值处理</span>
          )}
          <Button type={allDone ? "primary" : "default"} onClick={requestClose}>
            {allDone ? "完成" : "关闭"}
          </Button>
          {allDone ? null : (
            <Button
              type={eligible > 0 ? "default" : "primary"}
              aria-label={importStarted ? "检查剩余行" : "检查数据"}
              loading={busy === "check"}
              disabled={
                !canCheck || !!busy || loadingFile || started !== undefined
              }
              onClick={() => void run(true)}
            >
              {importStarted ? "检查剩余行" : "检查数据"}
            </Button>
          )}
          {eligible > 0 ? (
            <Button
              type="primary"
              loading={busy === "import"}
              disabled={!!busy || started !== undefined || revoked}
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
      onClose={requestClose}
      destroyOnHidden
    >
      {modalHolder}
      {parseError ? <Alert type="error" showIcon title={parseError} /> : null}
      {summary ? <Alert type="error" showIcon title={summary} /> : null}
      <div className={importStyles.flow}>
        <section className={importStyles.step}>
          <h3 className={importStyles.stepTitle}>选择文件</h3>
          <Button
            type="dashed"
            block
            className={importStyles.filePicker}
            data-empty={selectedFile ? undefined : ""}
            data-dragging={dragging ? "" : undefined}
            disabled={!!busy || loadingFile}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file && !busy && !loadingFile) void onFile(file, "auto");
            }}
          >
            {selectedFile ? (
              <span className={importStyles.fileSummary}>
                <strong>{selectedFile.name}</strong>
                {parsed && (
                  <span>
                    {parsed.rows.length} 行 · {parsed.headers.length} 列
                  </span>
                )}
                <span>重新选择</span>
              </span>
            ) : (
              <span className={importStyles.dropPrompt}>
                <InboxOutlined aria-hidden />
                <span>选择或拖入 Excel / CSV 文件</span>
                <small>最多 1 万行、40 列、10 MB</small>
              </span>
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
          <div className={importStyles.settings}>
            {selectedFile && !source?.sheetNames.length ? (
              <label className={importStyles.setting}>
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
                  onChange={(next: CsvEncoding) =>
                    void onFile(selectedFile, next)
                  }
                  options={[
                    {
                      value: "auto",
                      label: decodedEncoding
                        ? `自动识别（${decodedEncoding}）`
                        : "自动识别",
                    },
                    { value: "utf-8", label: "UTF-8" },
                    {
                      value: "gb18030",
                      label: "GBK / GB18030（中文 Windows）",
                    },
                  ]}
                />
              </label>
            ) : null}
            {source?.sheetNames.length ? (
              <label className={importStyles.setting}>
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
                    newSelection();
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
            {source && headers.length > 0 && (!autoHeader || pickHeader) && (
              <label className={importStyles.setting}>
                <span>表头在第几行</span>
                <Select
                  aria-label="表头在第几行"
                  value={headerRow}
                  disabled={!!busy || loadingFile || importStarted}
                  options={headers.map((h) => ({
                    value: h.rowNumber,
                    label: `第 ${h.rowNumber} 行 · ${h.cells.filter(Boolean).slice(0, 4).join(" / ").slice(0, 70)}`,
                  }))}
                  onChange={(row) => {
                    setHeaderLocked(true);
                    applyHeader(source, sheetName, row, false);
                  }}
                />
              </label>
            )}
          </div>
          {/* Row 1 is what anyone expects; only a header further down is
              worth a line under the select that already shows it. */}
          {source && !headerLocked && headerRow > 1 && !autoHeader && (
            <Typography.Text type="secondary" className={importStyles.note}>
              表头按第 {headerRow} 行读取，不对可以在上面改
            </Typography.Text>
          )}
          {autoHeader && headerRow > 1 && !pickHeader && (
            <Typography.Text type="secondary" className={importStyles.note}>
              已识别第 {headerRow} 行为表头
              <Button
                type="link"
                size="small"
                disabled={!!busy || loadingFile || importStarted}
                onClick={() => setPickHeader(true)}
              >
                调整
              </Button>
            </Typography.Text>
          )}
          {loadingFile ? (
            <Typography.Paragraph>正在读取文件…</Typography.Paragraph>
          ) : null}
          {importStarted && !allDone ? (
            <Typography.Paragraph type="secondary">
              已导入的行会保留。改好剩余的行后，用原文件重新检查。
            </Typography.Paragraph>
          ) : null}
        </section>
        {(parsed || preview || aiNotice) && (
          <section className={importStyles.step}>
            <h3 className={importStyles.stepTitle}>核对列对照</h3>
            {aiNotice && <Alert type="info" showIcon title={aiNotice} />}
            {preview && (
              <section aria-label="AI 文件对照" className={importStyles.assist}>
                <Typography.Paragraph className={importStyles.assistSummary}>
                  <AiSparkIcon aria-hidden className={importStyles.aiMark} />
                  {/* How many columns are skipped is said once, above the
                      table; here only whether AI still has work to do. */}
                  {preview.unresolvedColumns && preview.unresolvedValues
                    ? `还有列和 ${preview.unresolvedValues} 个取值没对上`
                    : preview.unresolvedColumns
                      ? "还有列没对上"
                      : preview.unresolvedValues
                        ? `还有 ${preview.unresolvedValues} 个取值没对上`
                        : preview.needed
                          ? "表头或日期格式待确认"
                          : "已完成对照"}
                </Typography.Paragraph>
                {started !== undefined ? (
                  <>
                    <span role="status">正在生成对照 · 已等 {elapsed} 秒</span>{" "}
                    <Button
                      onClick={() => cancelAssist("已取消，手动对照已保留")}
                    >
                      取消生成
                    </Button>
                  </>
                ) : (
                  !attempted &&
                  preview.needed && (
                    <Button
                      icon={<AiSparkIcon aria-hidden />}
                      disabled={!!busy}
                      onClick={() => void generate()}
                    >
                      AI 帮我对列
                    </Button>
                  )
                )}
                {!attempted && preview.needed && (
                  <small>将发送打码后的表头与样例</small>
                )}
                {!attempted && (
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: "scope",
                        label: "查看发送范围",
                        children: (
                          <>
                            <p>
                              将发送打码后的表头与样例、低基数未解值及频数。取消勾选即可排除整列。
                            </p>
                            {preview.partial && (
                              <p>仅部分取值可提供建议，余项请手动核对</p>
                            )}
                            {preview.request.columns.map((column, i) => {
                              const label = parsed?.headers[i] || column.header;
                              const privateColumn =
                                column.excluded && !excluded.includes(i);
                              return (
                                <div key={i}>
                                  <Checkbox
                                    checked={
                                      !privateColumn && !excluded.includes(i)
                                    }
                                    disabled={!!busy || privateColumn}
                                    onChange={(e) =>
                                      setExcluded((prev) =>
                                        e.target.checked
                                          ? prev.filter((v) => v !== i)
                                          : [...prev, i],
                                      )
                                    }
                                  >
                                    {label || "空表头"}（C{i + 1}） ·{" "}
                                    {column.samples.length} 个样例 ·{" "}
                                    {column.values?.length ?? 0} 个取值
                                  </Checkbox>
                                </div>
                              );
                            })}
                          </>
                        ),
                      },
                    ]}
                  />
                )}
                {current && (
                  <small className={importStyles.generatedAt}>
                    <AiBadge />
                    {new Date(current.plan.generatedAt).toLocaleTimeString()}
                  </small>
                )}
                {snapshot?.scope === assistScope &&
                  (draftChanged ? (
                    <Popconfirm
                      title="恢复后将覆盖生成建议以来的人工修改"
                      onConfirm={restore}
                      okText="恢复"
                      cancelText="取消"
                    >
                      <Button disabled={!!busy}>恢复到 AI 之前的对照</Button>
                    </Popconfirm>
                  ) : (
                    <Button disabled={!!busy} onClick={restore}>
                      恢复到 AI 之前的对照
                    </Button>
                  ))}
              </section>
            )}
            {parsed ? (
              <>
                {duplicateFields.length ? (
                  <Alert
                    type="error"
                    showIcon
                    title={`多个文件列映射到了同一字段：${[...new Set(duplicateFields.map((item) => item.field.label))].join("、")}。请保留一列，其余改为跳过。`}
                  />
                ) : null}
                {/* One line above the table; each column's own state is in
                    its row. */}
                {missingRequired.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    title={`还没对上必填字段：${missingRequired.map((field) => field.label).join("、")}`}
                  />
                ) : null}
                <div className={importStyles.mapping} aria-label="文件列对照">
                  <div className={importStyles.mappingHead} aria-hidden>
                    <span>文件列</span>
                    <span>导入到</span>
                    <span>状态</span>
                  </div>
                  {parsed.headers.map((header, index) => {
                    const label = header || `第 ${index + 1} 列`;
                    const field = importable.find(
                      (f) => f.fieldKey === mapping[index],
                    );
                    const advice = current?.plan.columns.find(
                      (a) => a.col === "C" + (index + 1),
                    );
                    const target = advice?.target;
                    const targetField =
                      target && target.mode !== "skip"
                        ? importable.find((f) => f.fieldKey === target.field)
                        : undefined;
                    const needsReview =
                      advice?.confidence === "review" &&
                      !adoptedColumns.includes(advice.col);
                    const fromAi =
                      origin?.plan.columns.find(
                        (a) =>
                          a.col === "C" + (index + 1) &&
                          (a.confidence !== "review" ||
                            adoptedColumns.includes(a.col)),
                      ) ||
                      (aiMapped?.scope === assistScope &&
                        mapping[index] !== SKIP &&
                        aiMapped.keys[index] === mapping[index]);
                    const lockedOwner = !canChooseOwner && ownerHeader(header);
                    return (
                      <div key={index} className={importStyles.row}>
                        <div>
                          <strong>{label}</strong>
                          {(sheetSummary?.samples[index].length ?? 0) > 70 ? (
                            <details>
                              <summary className={importStyles.example}>
                                {sheetSummary?.samples[index].slice(0, 70)}…
                                展开
                              </summary>
                              {sheetSummary?.samples[index]}
                            </details>
                          ) : (
                            <div className={importStyles.example}>
                              {sheetSummary?.samples[index]}
                            </div>
                          )}
                        </div>
                        <div className={importStyles.controls}>
                          <Select
                            disabled={
                              lockedOwner ||
                              !!busy ||
                              loadingFile ||
                              mappingLocked
                            }
                            id={`import-map-${index}`}
                            aria-label={`映射 ${label}`}
                            value={mapping[index]}
                            onChange={(next: string) => remap(index, next)}
                            options={[
                              { value: SKIP, label: "跳过此列" },
                              ...(canChooseOwner
                                ? [
                                    {
                                      value: OWNER,
                                      label: "按行指定负责人",
                                      disabled:
                                        ownerColumn >= 0 &&
                                        ownerColumn !== index,
                                    },
                                  ]
                                : []),
                              ...importable.map((field) => ({
                                value: field.fieldKey,
                                label: `${field.label}${assistEnabled && field.importManualOnly ? "（仅手动对照）" : ""} · ${FIELD_TYPE_LABELS[field.type]}${importable.some((other) => other.fieldKey !== field.fieldKey && other.label === field.label) ? `（${field.fieldKey}）` : ""}${field.required ? "（必填）" : ""}`,
                              })),
                              ...importable
                                .filter((f) => f.type === "TEXTAREA")
                                .map((f) => ({
                                  value: APPEND + f.fieldKey,
                                  label: `追加到「${f.label}」`,
                                })),
                            ]}
                          />
                          {lockedOwner && (
                            <small>仅公司管理员可按行指定负责人</small>
                          )}
                          {dateInferences[index] === "conflict" ? (
                            <small>
                              同一列的日期顺序冲突，请更正文件后重选
                            </small>
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
                          {field &&
                            (field.type === "NUMBER" ||
                              field.type === "MONEY") && (
                              <Select
                                aria-label={"无单位数值 " + label}
                                prefix="没写单位的数"
                                value={amountUnits[index] ?? "yuan"}
                                disabled={!!busy || mappingLocked}
                                options={[
                                  { value: "yuan", label: "按原数" },
                                  { value: "wan", label: "按万" },
                                ]}
                                onChange={(v) => {
                                  setAmountUnits((prev) => ({
                                    ...prev,
                                    [index]: v,
                                  }));
                                  resetResult(importStarted);
                                }}
                              />
                            )}
                          {field && isOptionField(field) && (
                            <ImportValues
                              key={JSON.stringify([
                                fileKey,
                                sheetName,
                                headerRow,
                                field.fieldKey,
                              ])}
                              rows={parsed.rows}
                              index={index}
                              field={field}
                              choices={valueChoices[index]}
                              advice={advice}
                              preview={current?.preview}
                              headerRow={headerRow}
                              disabled={!!busy || mappingLocked}
                              onChange={(choices) => {
                                setValueChoices((prev) => ({
                                  ...prev,
                                  [index]: choices,
                                }));
                                resetResult(importStarted);
                              }}
                              onAdopt={(value) =>
                                adopt({ column: "C" + (index + 1), value })
                              }
                            />
                          )}
                          {/* Only an unsure suggestion needs a line: what AI
                              thinks it is, and one click to take it. A sure one
                              is already in the select; its reason is on the tag. */}
                          {advice && needsReview && (
                            <small>
                              {targetField
                                ? `可能是「${targetField.label}」`
                                : "建议跳过"}
                              <Button
                                type="link"
                                size="small"
                                className={styles.inlineAdopt}
                                disabled={!!busy || mappingLocked}
                                onClick={() => adopt({ column: advice.col })}
                              >
                                采用
                              </Button>
                            </small>
                          )}
                        </div>
                        {(() => {
                          // One colour per state: matched (green), AI's pick
                          // (violet), left unmatched (amber), set by hand (grey).
                          const [label, tone] = manual.includes(index)
                            ? ["手动", "manual"]
                            : fromAi
                              ? ["AI 建议", "ai"]
                              : mapping[index] === SKIP
                                ? ["未对照", "unmatched"]
                                : ["自动", "auto"];
                          const tag = (
                            <span
                              className={importStyles.state}
                              data-tone={tone}
                              tabIndex={advice ? 0 : undefined}
                            >
                              {label}
                            </span>
                          );
                          return advice ? (
                            <Tooltip title={`AI：${advice.reason}`}>
                              {tag}
                            </Tooltip>
                          ) : (
                            tag
                          );
                        })()}
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
              </>
            ) : null}
          </section>
        )}
        <section className={importStyles.step}>
          <h3 className={importStyles.stepTitle}>新记录归属</h3>
          {canChooseOwner && ownerColumn < 0 ? (
            <label className={importStyles.setting}>
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
          {ownerCandidate && !importToPool && !mappingLocked ? (
            <div className={importStyles.ownerHint} role="note">
              <span>「{ownerCandidate.header}」列都是成员姓名</span>
              <Button
                size="small"
                disabled={!!busy || loadingFile}
                onClick={() => remap(ownerCandidate.index, OWNER)}
              >
                按「{ownerCandidate.header}」分配
              </Button>
            </div>
          ) : null}
          {/* The select and the pool checkbox say what they do; a line is
              only needed where there is no control to read. */}
          {ownerColumn >= 0 || !canChooseOwner ? (
            <p className={importStyles.note}>
              {ownerColumn >= 0
                ? "新增记录按文件中的负责人分别归属"
                : "本次新增记录归你负责"}
            </p>
          ) : null}
        </section>
        {parsed ? (
          <section className={importStyles.step}>
            <h3 className={importStyles.stepTitle}>查重</h3>
            <label className={importStyles.setting}>
              <span>
                查重字段
                <Tooltip title="选手机号、编号这类能认出同一条记录的字段，最多 3 个；所选字段全部相同的行会跳过，按你能看到的数据查。不选时只防同一文件重复导入，不同文件里的重复数据会新增。">
                  <InfoCircleOutlined
                    className={importStyles.info}
                    aria-label="查重说明"
                    tabIndex={0}
                  />
                </Tooltip>
              </span>
              <Select
                mode="multiple"
                aria-label="查重字段"
                style={{ minWidth: "min(320px, 100%)" }}
                value={matchFields}
                maxCount={3}
                disabled={!!busy || loadingFile || mappingLocked}
                placeholder="不查重"
                options={matchableFields.map(({ field }) => ({
                  value: field.fieldKey,
                  label: field.label,
                }))}
                onChange={(fields) => {
                  setMatchFields(fields);
                  setMatchLocked(true);
                  resetResult(importStarted);
                }}
              />
            </label>
            {!!sheetSummary?.duplicateRows && (
              <Alert
                type="warning"
                showIcon
                title={`文件中有 ${sheetSummary.duplicateRows} 行与其他行完全相同${recommendedMatch ? "，建议使用「" + recommendedMatch.label + "」查重" : ""}`}
              />
            )}
          </section>
        ) : null}
        {!busy && (checked || (result && importStarted)) ? (
          <section
            className={importStyles.step}
            aria-label={checked ? "检查结果" : "导入结果"}
            ref={verdictRef}
          >
            <h3 className={importStyles.stepTitle}>
              {checked ? "检查结果" : "导入结果"}
            </h3>
            {checked ? (
              <>
                <p className={importStyles.verdictCounts} role="status">
                  <span>
                    可导入 <b>{eligible}</b>
                  </span>
                  {duplicateCount ? (
                    <span title="和已有记录或文件里的其他行重复">
                      重复 <b>{duplicateCount}</b>
                    </span>
                  ) : null}
                  {manualSkipCount ? (
                    <span>
                      跳过 <b>{manualSkipCount}</b>
                    </span>
                  ) : null}
                  {checked.failed ? (
                    <span data-tone="danger">
                      错误 <b>{checked.failed}</b>
                    </span>
                  ) : null}
                </p>
                {eligible === 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="没有可导入的行"
                    description={
                      [
                        duplicateCount
                          ? `${duplicateCount} 行和已有记录或文件里的其他行重复`
                          : "",
                        manualSkipCount ? `${manualSkipCount} 行设为跳过` : "",
                        checked.failed ? `${checked.failed} 行有错误` : "",
                      ]
                        .filter(Boolean)
                        .join("，") + "。"
                    }
                  />
                ) : (
                  <>
                    {unassigned ? (
                      <Alert
                        type="warning"
                        showIcon
                        title={`这 ${eligible} 行导入后没有负责人`}
                        description="只看自己负责记录的成员看不到它们，也不会有人收到跟进提醒。"
                        action={
                          ownerCandidate ? (
                            <Button
                              size="small"
                              onClick={() => remap(ownerCandidate.index, OWNER)}
                            >
                              按「{ownerCandidate.header}」分配
                            </Button>
                          ) : undefined
                        }
                      />
                    ) : null}
                    <ImportCheckPreview
                      parsed={parsed!}
                      rows={readyPlan!.rows.filter((row) =>
                        checked.items.some(
                          (item) =>
                            item.rowNumber === row.rowNumber &&
                            item.status === "READY",
                        ),
                      )}
                      mapping={mapping}
                      fields={importable}
                      members={members}
                      timeZone={timeZone}
                      showOwner={canChooseOwner}
                    />
                  </>
                )}
              </>
            ) : result ? (
              <Alert
                type={result.failed ? "warning" : "success"}
                showIcon
                title={
                  result.failed
                    ? `已导入 ${result.created} 行，${result.failed} 行没有导入`
                    : `已导入 ${result.created} 行`
                }
                description={
                  result.skipped
                    ? `另有 ${result.skipped} 行按查重规则跳过。`
                    : undefined
                }
              />
            ) : null}
          </section>
        ) : null}
        {busy && progress.total > 0 ? (
          <div className={importStyles.progress}>
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              status={busy ? "active" : undefined}
            />
            <Typography.Paragraph>
              {busy === "check" ? "检查" : "处理"}进度：{progress.done} /{" "}
              {progress.total} 行
            </Typography.Paragraph>
          </div>
        ) : null}
        {displayedResult && displayedResult.failed > 0 ? (
          <ul className={styles.batchErrors}>
            {displayedResult.items
              .filter((item) => item.status === "FAILED")
              .slice(0, 50)
              .map((item) => (
                <li key={item.rowNumber}>
                  {importRowError(item, schema.fields)}
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
      </div>
    </Drawer>
  );
}
