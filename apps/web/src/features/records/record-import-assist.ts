import {
  candidateEnumField,
  importEnumAlias,
  importScalarSample,
  projectImportHeading,
  restrictedLabel,
} from "@crm/contracts/import-heading";
import { businessLabel } from "./record-import-heading";
import type {
  ImportAssistRequest,
  ImportAssistPlan,
  ImportPreviewColumn,
} from "@crm/contracts";
import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import {
  coerceImportValue,
  isImportFormulaError,
  isImportNullMarker,
  matchImportOption,
  normalizeHeader,
  matchingImportOptions,
  inferImportDateOrder,
  splitImportOptions,
} from "./record-csv";
import type { ImportFile } from "./record-import-file";
import { initialMapping, SKIP, OWNER, APPEND } from "./record-import-mapping";

export const importableField = (f: PublishedFieldView) =>
  !f.isSystem &&
  f.type !== "MEMBER" &&
  (f.access === "EDIT" || f.access === "CREATE_ONLY");
export const aiImportableField = (f: PublishedFieldView) =>
  importableField(f) && !f.importManualOnly;
export type AssistDraft = {
  mapping: string[];
  manual: number[];
  matchFields: string[];
  matchLocked?: boolean;
  dateOrders: Record<number, "DMY" | "MDY">;
  amountUnits: Record<number, "yuan" | "wan">;
  valueChoices: Record<number, ReadonlyMap<string, string | null>>;
};
export function emptyAssistDraft(
  headers: string[],
  fields: PublishedFieldView[],
  admin: boolean,
): AssistDraft {
  return {
    mapping: initialMapping(headers, fields.filter(aiImportableField), admin),
    manual: [],
    matchFields: [],
    dateOrders: {},
    amountUnits: {},
    valueChoices: {},
  };
}

function valueShape(raw: string) {
  const safe = importScalarSample(raw);
  if (!safe) return "[文本]";
  if (safe.includes("@") || safe === "[邮箱]") return "[邮箱]";
  if (safe.includes("****") || safe === "[号码]") return "[号码]";
  if (/^\d+[-/]\d+[-/]\d+$/.test(safe)) return "[日期]";
  if (/^[¥￥+\d-]/.test(safe)) return "[数值]";
  return "[文本]";
}
export function importValueCounts(
  rows: string[][],
  index: number,
  field?: PublishedFieldView,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = (row[index] ?? "").trim();
    let parts = [raw];
    if (field?.type === "MULTI_SELECT") parts = splitImportOptions(raw);
    for (const part of new Set(parts))
      if (part) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  return counts;
}
export const isOptionField = (field?: PublishedFieldView) =>
  field?.type === "SINGLE_SELECT" || field?.type === "MULTI_SELECT";
export const activeOptions = (field?: PublishedFieldView) =>
  field ? selectOptions(field).filter((o) => o.status === "ACTIVE") : [];
export async function buildImportHeaderEvidence(
  file: ImportFile,
  sheet: string,
  headerRow: number,
) {
  return Promise.all(
    file.sheet(sheet, headerRow).headers.map(async (header) => {
      const bytes = new TextEncoder().encode(normalizeHeader(header));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    }),
  );
}
type PreviewInput = {
  headerEvidence: string[];
  file: ImportFile;
  sheet: string;
  headerRow: number;
  fields: PublishedFieldView[];
  draft: AssistDraft;
  excluded?: number[];
  admin?: boolean;
};
export function buildImportPreview({
  headerEvidence,
  file,
  sheet,
  headerRow,
  fields,
  draft,
  excluded = [],
}: PreviewInput) {
  const blocked = new Set(excluded);
  const denied = new Set(
    fields
      .filter(
        (f) =>
          !aiImportableField(f) ||
          restrictedLabel(f.label) ||
          restrictedLabel(f.fieldKey),
      )
      .flatMap((f) => [normalizeHeader(f.label), normalizeHeader(f.fieldKey)]),
  );
  const allowed = fields.filter(
    (f) => ![f.label, f.fieldKey].some((v) => denied.has(normalizeHeader(v))),
  );
  const parsed = file.sheet(sheet, headerRow);
  parsed.headers.forEach((raw, i) => {
    if (restrictedLabel(raw) || denied.has(normalizeHeader(raw)))
      blocked.add(i);
  });
  draft.mapping.forEach((key, i) => {
    const targetKey = key.startsWith(APPEND) ? key.slice(APPEND.length) : key;
    if (
      key === OWNER ||
      fields.some((f) => f.fieldKey === targetKey && !allowed.includes(f))
    )
      blocked.add(i);
  });
  const request: ImportAssistRequest = {
    sheet:
      (businessLabel(sheet.trim()) && projectImportHeading(sheet, false)) ||
      "工作表",
    columns: [],
  };
  const bindings = new Map<string, string>();
  const ambiguousDates = new Set<string>();
  let unresolvedColumns = 0,
    unresolvedValues = 0;
  let partial = false;
  const columns = parsed.headers.map((raw, i): ImportPreviewColumn => {
    const col = "C" + (i + 1),
      key = draft.mapping[i];
    const c: ImportPreviewColumn = {
      col,
      headerHash: headerEvidence[i],
      header: "",
      samples: [],
    };
    if (blocked.has(i)) return { ...c, excluded: true };
    const field = allowed.find((f) => f.fieldKey === key);
    if (field) c.locked = { mode: "field", field: key };
    else if (key.startsWith(APPEND))
      c.locked = { mode: "append", field: key.slice(APPEND.length) };
    else if (draft.manual.includes(i)) c.locked = { mode: "skip" };
    const header = projectImportHeading(raw, true);
    c.header = header;
    const isEnum = isOptionField(field);
    const isDate = field?.type === "DATE" || field?.type === "DATETIME";
    if (c.locked && !isEnum && !isDate) return c;
    if (!header) {
      c.header = raw ? "[文本]" : "";
      c.samples = [
        ...new Set(
          parsed.rows
            .slice(0, 5)
            .map((r) => r[i])
            .filter(Boolean)
            .map(valueShape),
        ),
      ];
      return c;
    }
    if (isDate || !c.locked) {
      if (inferImportDateOrder(parsed.rows.map((r) => r[i])) === "ambiguous")
        ambiguousDates.add(headerRow + ":" + col);
      if (
        isDate &&
        (draft.dateOrders[i] || !ambiguousDates.has(headerRow + ":" + col))
      )
        return c;
    }
    const enumField = isEnum
      ? field
      : !c.locked
        ? candidateEnumField(header, allowed)
        : undefined;
    const counts = importValueCounts(parsed.rows, i, enumField ?? field);
    const lowCardinality = counts.size <= 50;
    const options = activeOptions(enumField),
      samples = new Set<string>();
    const values: NonNullable<ImportPreviewColumn["values"]> = [];
    for (const [raw, count] of counts) {
      const exact = enumField ? matchingImportOptions(raw, options) : [];
      if (
        enumField &&
        (isImportNullMarker(enumField.type, raw) ||
          exact.length === 1 ||
          draft.valueChoices[i]?.has(raw))
      )
        continue;
      if (isEnum) unresolvedValues++;
      if (exact.length > 1) {
        partial = true;
        continue;
      }
      const safe =
        enumField && lowCardinality
          ? importEnumAlias(raw)
          : importScalarSample(raw);
      if (!safe) {
        if (isEnum) partial = true;
        continue;
      }
      if (!lowCardinality && isEnum) partial = true;
      if ((!c.locked || isDate) && !enumField && samples.size < 5)
        samples.add(safe);
      if (lowCardinality && enumField) {
        const id = "V" + (values.length + 1);
        values.push({ id, text: safe, count });
        bindings.set(headerRow + ":" + col + ":" + id, raw);
      }
    }
    c.samples = [...samples];
    if (values.length) c.values = values;
    return c;
  });
  unresolvedColumns = draft.mapping.filter(
    (k, i) => k === SKIP && !draft.manual.includes(i) && !blocked.has(i),
  ).length;
  request.columns = columns;
  const all = columns;
  const bytes = () => new TextEncoder().encode(JSON.stringify(request)).length;
  let remaining = bytes();
  if (remaining > 80 * 1024) {
    partial = true;
    for (let n = 4; n >= 0 && remaining > 80 * 1024; n--) {
      for (const c of all) c.samples = c.samples.slice(0, n);
      remaining = bytes();
    }
    for (const c of [...all].reverse()) {
      if (remaining <= 80 * 1024) break;
      if (c.values) {
        remaining -= new TextEncoder().encode(JSON.stringify(c.values)).length;
        delete c.values;
      }
    }
  }
  const needed =
    allowed.length > 0 &&
    all.some(
      (c) =>
        !c.excluded &&
        c.header &&
        c.header !== "[文本]" &&
        (!c.locked ||
          c.values?.length ||
          (c.samples.length && c.locked.mode === "field")),
    );
  return {
    request,
    headerRow,
    bindings,
    ambiguousDates,
    needed,
    partial,
    unresolvedColumns,
    unresolvedValues,
  };
}
export type ImportPreview = ReturnType<typeof buildImportPreview>;
export type AdoptChoice = { column: string; value?: string };
export function applyImportAdvice(
  draft: AssistDraft,
  preview: ImportPreview,
  plan: ImportAssistPlan,
  fields: PublishedFieldView[],
  adopt?: AdoptChoice,
  queryKeys?: string[],
): AssistDraft {
  const candidate = preview.request;
  const next: AssistDraft = {
    ...draft,
    mapping: [...draft.mapping],
    dateOrders: { ...draft.dateOrders },
    amountUnits: { ...draft.amountUnits },
    valueChoices: { ...draft.valueChoices },
  };
  const allowed = fields.filter(aiImportableField);
  for (const a of plan.columns) {
    const i = candidate.columns.findIndex((c) => c.col === a.col),
      source = candidate.columns[i];
    if (
      !source ||
      source.excluded ||
      !source.header ||
      (adopt && adopt.column !== a.col)
    )
      continue;
    const { target } = a;
    if (target.mode === "skip") continue;
    const field = allowed.find((f) => f.fieldKey === target.field);
    if (!field || (target.mode === "append" && field.type !== "TEXTAREA"))
      continue;
    const key = (target.mode === "append" ? APPEND : "") + target.field;
    if (
      source.locked &&
      (source.locked.mode !== target.mode ||
        source.locked.field !== target.field)
    )
      continue;
    if (
      target.mode === "field" &&
      (next.mapping.some((k, j) => j !== i && k === key) ||
        plan.columns.some(
          (b) =>
            b.col !== a.col &&
            b.target.mode === "field" &&
            b.target.field === key &&
            !source.locked,
        ))
    )
      continue;
    if (next.mapping[i] !== key) {
      if (
        next.mapping[i] !== SKIP ||
        draft.manual.includes(i) ||
        (a.confidence !== "high" && (!adopt || adopt.value))
      )
        continue;
      next.mapping[i] = key;
    }
    if (a.confidence === "high" || (adopt && !adopt.value)) {
      if (
        a.dateOrder &&
        (field.type === "DATE" || field.type === "DATETIME") &&
        preview.ambiguousDates.has(preview.headerRow + ":" + a.col)
      )
        next.dateOrders[i] ??= a.dateOrder;
      if (
        a.bareAmountUnit &&
        (field.type === "MONEY" || field.type === "NUMBER") &&
        !source.locked
      )
        next.amountUnits[i] ??= a.bareAmountUnit;
    }
    if (!isOptionField(field)) continue;
    const choices = new Map(next.valueChoices[i]);
    for (const v of a.values ?? []) {
      if (v.confidence !== "high" && adopt?.value !== v.value) continue;
      if (!source.values?.some((item) => item.id === v.value)) continue;
      const raw = preview.bindings.get(
        preview.headerRow + ":" + a.col + ":" + v.value,
      );
      if (
        raw !== undefined &&
        !choices.has(raw) &&
        matchingImportOptions(raw, activeOptions(field)).length === 0 &&
        (v.option === null ||
          activeOptions(field).some((o) => o.key === v.option))
      )
        choices.set(raw, v.option);
    }
    next.valueChoices[i] = choices;
  }
  if (!draft.matchLocked)
    next.matchFields = [
      ...new Set([
        ...draft.matchFields,
        ...plan.matchFields.filter(
          (k) =>
            next.mapping.includes(k) &&
            allowed.some(
              (f) => f.fieldKey === k && f.type !== "MULTI_SELECT",
            ) &&
            (!queryKeys || queryKeys.includes(k)),
        ),
      ]),
    ].slice(0, 3);
  return next;
}

export function remainingImportValues(
  rows: string[][],
  index: number,
  field: PublishedFieldView,
  choices?: ReadonlyMap<string, string | null>,
) {
  const options = activeOptions(field);
  const counts = new Map<string, number>();
  const unresolved = new Set<string>();
  let rowCount = 0;
  for (const row of rows) {
    const raw = row[index]?.trim();
    if (
      !raw ||
      isImportNullMarker(field.type, raw) ||
      isImportFormulaError(field.type, raw)
    )
      continue;
    const parts =
      field.type === "MULTI_SELECT" ? splitImportOptions(raw) : [raw];
    let affected = false;
    for (const value of new Set(parts)) {
      if (matchImportOption(value, options) !== undefined) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
      if (!choices?.has(value)) {
        unresolved.add(value);
        affected = true;
      }
    }
    if (affected) rowCount++;
  }
  return { entries: [...counts], values: [...unresolved], rowCount };
}

export function setRemainingImportValues(
  choices: ReadonlyMap<string, string | null> | undefined,
  values: readonly string[],
  undo = false,
) {
  const next = new Map(choices);
  for (const raw of values) {
    if (undo) {
      if (next.get(raw) === null) next.delete(raw);
    } else if (!next.has(raw)) next.set(raw, null);
  }
  return next;
}

const competingColumnLabels = {
  DATE: "日期",
  DATETIME: "日期时间",
  MONEY: "金额",
  NUMBER: "数值",
} as const;
type ComparableType = keyof typeof competingColumnLabels;

function parsesAs(type: ComparableType, value: string, timeZone?: string) {
  if (!value?.trim() || isImportNullMarker(type, value)) return false;
  const orders =
    type === "DATE" || type === "DATETIME"
      ? (["DMY", "MDY"] as const)
      : [undefined];
  return orders.some((dateOrder) => {
    try {
      return (
        coerceImportValue(type, value, [], { timeZone, dateOrder }) !== null
      );
    } catch {
      return false;
    }
  });
}

export function reviewImportPlan(
  plan: ImportAssistPlan,
  preview: ImportPreview,
  file: ImportFile,
  sheet: string,
  fields: PublishedFieldView[],
  timeZone?: string,
): ImportAssistPlan {
  const candidate = preview.request;
  // Compare all physical cells locally, including rows beyond the sampled or masked preview.
  let rows: string[][] | undefined;
  const compatible = new Map<ComparableType, string[]>();
  const columns = plan.columns.map((advice) => {
    const target = advice.target;
    if (advice.confidence !== "high" || target.mode !== "field") return advice;
    const type = fields.find((field) => field.fieldKey === target.field)?.type;
    if (
      type !== "DATE" &&
      type !== "DATETIME" &&
      type !== "MONEY" &&
      type !== "NUMBER"
    )
      return advice;
    let sources = compatible.get(type);
    if (!sources) {
      rows ??= file.sheet(sheet, preview.headerRow).rows;
      const data = rows;
      sources = candidate.columns
        .filter(
          (col, i) =>
            !col.excluded &&
            !col.locked &&
            data.some((row) => parsesAs(type, row[i], timeZone)),
        )
        .map((col) => col.col);
      compatible.set(type, sources);
    }
    if (!sources.some((col) => col !== advice.col)) return advice;
    return {
      ...advice,
      confidence: "review" as const,
      reason: "文件中还有其他" + competingColumnLabels[type] + "列，请确认",
    };
  });
  return { ...plan, columns };
}
