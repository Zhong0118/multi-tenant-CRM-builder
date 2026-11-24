import {
  maskImportLabel,
  maskImportNumber,
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
  importableField(f) &&
  !f.importManualOnly &&
  !restrictedLabel(f.fieldKey) &&
  !restrictedLabel(f.label);
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

// Physical positions remain stable even when the user chooses another header.
export function draftForImportHeader(
  headers: string[],
  fields: PublishedFieldView[],
  admin: boolean,
  previous: AssistDraft,
) {
  const next = emptyAssistDraft(headers, fields, admin);
  next.manual = previous.manual.filter((i) => i < headers.length);
  for (const i of next.manual) next.mapping[i] = previous.mapping[i];
  for (const [i, key] of next.mapping.entries()) {
    if (previous.mapping[i] !== key) continue;
    if (previous.valueChoices[i])
      next.valueChoices[i] = previous.valueChoices[i];
    if (previous.dateOrders[i]) next.dateOrders[i] = previous.dateOrders[i];
    if (previous.amountUnits[i]) next.amountUnits[i] = previous.amountUnits[i];
  }
  next.matchFields = previous.matchFields.filter((key) =>
    next.mapping.includes(key),
  );
  next.matchLocked = previous.matchLocked;
  return next;
}

const enumLabel =
  /^(?:[A-FＳS](?:类|级|档|等)?|(?:重点|普通|潜在|意向|成交|老|新)(?:客户)?|未评级|高|中|低|展会|转介|转介绍|线上|线下|广告|网站|其他|未知|待联系|已联系|进行中|已完成|是|否|true|false|yes|no)$/i;
const clip = (s: string) => Array.from(s).slice(0, 40).join("");
function safeValue(raw: string): string | undefined {
  const v = raw.trim().normalize("NFKC");
  if (
    /^\d{4}[-/]\d\d?[-/]\d\d?$/.test(v) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(v)
  )
    return v;
  if (/^[\w.%+\-]+@[\w.-]+\.[a-z]{2,}$/i.test(v)) return maskImportLabel(v);
  if (
    /^[+\d(][\d\s()+,.\-–—]{5,}\d[xX]?$/.test(v) &&
    v.replace(/\D/g, "").length >= 7
  )
    return maskImportNumber(v);
  if (
    /^(?:[+-]?[¥￥]?\d{1,6}(?:[,.]\d{1,6})*(?:[万亿]?元?)?|\d{1,4}[-/]\d{1,2}[-/]\d{2,4})$/.test(
      v,
    ) ||
    enumLabel.test(v)
  )
    return clip(v);
}
function valueShape(raw: string) {
  const safe = safeValue(raw);
  if (!safe) return "[文本]";
  if (safe.includes("@")) return "[邮箱]";
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
    else if (!field && /[;；,，]/.test(raw)) {
      const tokens = splitImportOptions(raw);
      if (tokens.every((token) => enumLabel.test(token))) parts = tokens;
    }
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
) {
  const columns = new Map<number, Set<string>>();
  for (const row of file.headerSelection(sheet, []).candidates) {
    row.cells.forEach((raw, i) => {
      const key = normalizeHeader(raw);
      if (!key) return;
      const values = columns.get(i) ?? new Set<string>();
      values.add(key);
      columns.set(i, values);
    });
  }
  return Promise.all(
    [...columns].map(async ([i, values]) => ({
      col: "C" + (i + 1),
      hashes: await Promise.all(
        [...values].map(async (key) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(key),
          );
          return [...new Uint8Array(digest)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }),
      ),
    })),
  );
}
type PreviewInput = {
  headerEvidence: { col: string; hashes: string[] }[];
  file: ImportFile;
  sheet: string;
  headerRow: number;
  headerLocked: boolean;
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
  headerLocked,
  fields,
  draft,
  excluded = [],
  admin = false,
}: PreviewInput) {
  const allowed = fields.filter(aiImportableField),
    blocked = new Set(excluded);
  const denied = new Set(
    fields
      .filter((f) => !aiImportableField(f))
      .flatMap((f) => [normalizeHeader(f.label), normalizeHeader(f.fieldKey)]),
  );
  const leading = file.headerSelection(sheet, allowed).candidates;
  for (const row of leading)
    row.cells.forEach((s, i) => {
      if (restrictedLabel(s) || denied.has(normalizeHeader(s))) blocked.add(i);
    });
  draft.mapping.forEach((key, i) => {
    const targetKey = key.startsWith(APPEND) ? key.slice(APPEND.length) : key;
    if (
      key === OWNER ||
      fields.some((f) => f.fieldKey === targetKey && !aiImportableField(f))
    )
      blocked.add(i);
  });
  const request: ImportAssistRequest = {
    headerEvidence,
    sheet:
      (businessLabel(sheet.trim()) && projectImportHeading(sheet, false)) ||
      "工作表",
    currentHeader: headerRow,
    headerLocked,
    candidates: [],
  };
  const bindings = new Map<string, string>();
  const ambiguousDates = new Set<string>();
  let unresolvedColumns = 0,
    unresolvedValues = 0;
  let partial = false;
  for (const candidate of leading) {
    const current = candidate.rowNumber === headerRow;
    if (
      !current &&
      (headerLocked ||
        !candidate.cells.some(
          (s, i) => !blocked.has(i) && projectImportHeading(s, false),
        ))
    )
      continue;
    let parsed;
    try {
      parsed = file.sheet(sheet, candidate.rowNumber);
    } catch {
      if (current)
        request.candidates.push({
          headerRow,
          columns: candidate.cells.map((_, i) => ({
            col: "C" + (i + 1),
            header: "",
            samples: [],
            ...(blocked.has(i)
              ? { excluded: true }
              : { locked: { mode: "skip" as const } }),
          })),
        });
      continue;
    }
    const base = current
      ? draft
      : draftForImportHeader(parsed.headers, fields, admin, draft);
    const columns = parsed.headers.map((raw, i): ImportPreviewColumn => {
      const col = "C" + (i + 1),
        key = base.mapping[i];
      const c: ImportPreviewColumn = { col, header: "", samples: [] };
      if (blocked.has(i)) return { ...c, excluded: true };
      if (
        !current &&
        (draft.manual.includes(i) ||
          (draft.mapping[i] && draft.mapping[i] !== SKIP))
      )
        return { ...c, locked: { mode: "skip" } };
      const field = allowed.find((f) => f.fieldKey === key);
      if (field) c.locked = { mode: "field", field: key };
      else if (key.startsWith(APPEND))
        c.locked = { mode: "append", field: key.slice(APPEND.length) };
      else if (base.manual.includes(i)) c.locked = { mode: "skip" };
      const header = projectImportHeading(raw, current && headerLocked);
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
          ambiguousDates.add(candidate.rowNumber + ":" + col);
        if (
          isDate &&
          (base.dateOrders[i] ||
            !ambiguousDates.has(candidate.rowNumber + ":" + col))
        )
          return c;
      }
      const counts = importValueCounts(parsed.rows, i, field);
      const lowCardinality =
        counts.size <= 50 &&
        new Set(parsed.rows.map((r) => r[i]?.trim()).filter(Boolean)).size <=
          50;
      const options = activeOptions(field),
        samples = new Set<string>();
      const values: NonNullable<ImportPreviewColumn["values"]> = [];
      for (const [raw, count] of counts) {
        const exact = isEnum ? matchingImportOptions(raw, options) : [];
        if (isEnum && (exact.length === 1 || base.valueChoices[i]?.has(raw)))
          continue;
        if (current && isEnum) unresolvedValues++;
        if (exact.length > 1) {
          partial = true;
          continue;
        }
        const safe = safeValue(raw);
        if (!safe) {
          if (isEnum) partial = true;
          continue;
        }
        if (!lowCardinality && isEnum) partial = true;
        if ((!c.locked || isDate) && samples.size < 5) samples.add(safe);
        if (lowCardinality && !isDate) {
          const id = "V" + (values.length + 1);
          values.push({ id, text: safe, count });
          bindings.set(candidate.rowNumber + ":" + col + ":" + id, raw);
        }
      }
      c.samples = [...samples];
      if (values.length) c.values = values;
      return c;
    });
    if (current)
      unresolvedColumns = base.mapping.filter(
        (k, i) => k === SKIP && !base.manual.includes(i) && !blocked.has(i),
      ).length;
    request.candidates.push({ headerRow: candidate.rowNumber, columns });
  }
  const all = request.candidates.flatMap((c) => c.columns);
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
  // Ten fully populated candidate rows can exceed the limit even without examples.
  for (const candidate of [...request.candidates].reverse()) {
    if (bytes() <= 80 * 1024) break;
    if (candidate.headerRow !== headerRow)
      request.candidates.splice(request.candidates.indexOf(candidate), 1);
  }
  const retained = request.candidates.flatMap((c) => c.columns);
  const needed =
    allowed.length > 0 &&
    (retained.some(
      (c) =>
        !c.excluded &&
        c.header &&
        c.header !== "[文本]" &&
        (!c.locked ||
          c.values?.length ||
          (c.samples.length && c.locked.mode === "field")),
    ) ||
      (!headerLocked &&
        request.candidates.filter((row) =>
          row.columns.some(
            (c) =>
              !c.excluded &&
              c.locked?.mode !== "skip" &&
              c.header &&
              c.header !== "[文本]",
          ),
        ).length > 1));
  return {
    request,
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
  const candidate = preview.request.candidates.find(
    (c) => c.headerRow === plan.headerRow,
  );
  if (!candidate) return draft;
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
        preview.ambiguousDates.has(plan.headerRow + ":" + a.col)
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
        plan.headerRow + ":" + a.col + ":" + v.value,
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
