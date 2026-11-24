import { createHash } from 'node:crypto';
import type {
  ImportAssistPlan,
  ImportAssistRequest,
  ImportColumnAdvice,
} from '@crm/contracts';
import { z } from 'zod';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { queryFields } from '../records/record-filter';
import { selectOptions } from '../records/record-value-engine';
import { allowsProposalFieldKey } from './ai-proposal.schema';
import { columnAdvice, valueAdvice } from './dto/import-assist.dto';
import type {
  ImportAssistModelInput,
  ImportModelColumn,
} from './import-assist-model';
import {
  cellShape,
  reservedHeadings,
  dictionaryLabel,
  headerKey,
  restrictedLabel,
  sampleShape,
  sourceHeader,
} from './import-assist-privacy';

const optionKey = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '');
const budget = 40 * 1024; // reserve 8 KiB for provider instructions and framing
const byteSize = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
function trimInput(input: ImportAssistModelInput) {
  const columns = input.candidates.flatMap((c) => c.columns);
  for (let n = 4; n >= 0 && byteSize(input) > budget; n--) {
    for (const c of columns) c.samples = c.samples.slice(0, n);
  }
  if (byteSize(input) <= budget) return;
  for (const c of [...columns].reverse()) {
    if (c.values.length) {
      c.values = [];
      c.partial = true;
    }
    if (byteSize(input) <= budget) return;
  }
  // Make room for a usable dictionary on wide, multi-row previews.
  while (byteSize({ ...input, fields: [] }) > budget * 0.8) {
    const widest = input.candidates.reduce((a, b) =>
      a.columns.length >= b.columns.length ? a : b,
    );
    widest.columns.pop();
  }
  // Prefer dropping one large option dictionary over many small scalar fields.
  const largest = input.fields
    .map((f) => ({ ref: f.ref, bytes: byteSize(f) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const { ref } of largest) {
    if (byteSize(input) <= budget) break;
    input.fields = input.fields.filter((f) => f.ref !== ref);
    for (const row of input.candidates) {
      row.columns = row.columns.filter((c) => c.locked?.field !== ref);
      for (const c of row.columns) c.partial = true;
    }
  }
}

export function prepareImport(
  resolved: ResolvedObjectSchema,
  req: ImportAssistRequest,
) {
  const blockedLabels = new Set(reservedHeadings);
  const allowed = resolved.schema.fields
    .filter((f) => {
      const ok =
        ['EDIT', 'CREATE_ONLY'].includes(resolved.access.fields[f.fieldKey]) &&
        !f.isSystem &&
        f.type !== 'MEMBER' &&
        allowsProposalFieldKey(f.fieldKey) &&
        !restrictedLabel(f.fieldKey) &&
        !restrictedLabel(f.label);
      if (!ok)
        for (const label of [f.label, f.fieldKey])
          blockedLabels.add(headerKey(label));
      return ok;
    })
    .filter(
      (f) =>
        ![f.label, f.fieldKey].some((s) => blockedLabels.has(headerKey(s))),
    );
  const blockedCols = new Set<string>();
  const blockedHashes = new Set(
    [...blockedLabels].map((s) => createHash('sha256').update(s).digest('hex')),
  );
  const safePositions = new Set(
    req.headerEvidence
      .filter(
        (e) => e.hashes.length && !e.hashes.some((h) => blockedHashes.has(h)),
      )
      .map((e) => e.col),
  );
  for (const row of req.candidates)
    for (const c of row.columns) {
      const lockedField =
        c.locked && 'field' in c.locked ? c.locked.field : undefined;
      if (
        !safePositions.has(c.col) ||
        c.excluded ||
        c.locked?.mode === 'owner' ||
        restrictedLabel(c.header) ||
        blockedLabels.has(headerKey(c.header)) ||
        (lockedField !== undefined &&
          !allowed.some((f) => f.fieldKey === lockedField))
      )
        blockedCols.add(c.col);
    }
  const queryable = new Set(queryFields(resolved).map((f) => f.fieldKey));
  let optionNumber = 0,
    valueNumber = 0;
  const targets = allowed.map((f, i) => {
    const ref = 'F' + (i + 1);
    const options = ['SINGLE_SELECT', 'MULTI_SELECT'].includes(f.type)
      ? selectOptions(f)
          .filter((o) => o.status === 'ACTIVE')
          .map((o) => ({ ...o, ref: 'O' + ++optionNumber }))
      : [];
    return {
      field: f,
      ref,
      options,
      aliases: [headerKey(f.label), headerKey(f.fieldKey)],
    };
  });
  const currentLocks = new Map<string, string | undefined>();
  for (const c of req.candidates.find(
    (row) => row.headerRow === req.currentHeader,
  )!.columns) {
    const lock = c.locked;
    const matches = targets.filter((t) =>
      t.aliases.includes(headerKey(c.header)),
    );
    if (lock || matches.length === 1)
      currentLocks.set(
        c.col,
        lock
          ? lock.mode === 'field'
            ? targets.find((t) => t.field.fieldKey === lock.field)?.ref
            : undefined
          : matches[0].ref,
      );
  }
  const fileValues = new Map<string, { id: string; text: string }>();
  const mapped = new Map<number, Set<string>>();
  const occupied = new Map<number, Set<string>>();
  const formatColumns = new Set<ImportModelColumn>();
  const input: ImportAssistModelInput = {
    sheet: blockedLabels.has(headerKey(req.sheet))
      ? '工作表'
      : sourceHeader(req.sheet),
    currentHeader: req.currentHeader,
    headerLocked: req.headerLocked,
    fields: targets.map(({ field: f, ref, options }) => ({
      ref,
      name: dictionaryLabel(f.label),
      type: f.type,
      required: f.required,
      options: options.map((o) => ({
        ref: o.ref,
        name: dictionaryLabel(o.label),
      })),
    })),
    candidates: req.candidates
      .filter((row) => !req.headerLocked || row.headerRow === req.currentHeader)
      .map((row) => {
        const used = new Set<string>();
        if (row.headerRow !== req.currentHeader)
          for (const ref of currentLocks.values()) if (ref) used.add(ref);
        occupied.set(row.headerRow, used);
        const confirmed = new Set<string>();
        mapped.set(row.headerRow, confirmed);
        const columns: ImportModelColumn[] = [];
        for (const c of row.columns) {
          if (row.headerRow !== req.currentHeader && currentLocks.has(c.col))
            continue;
          const match = targets.filter((t) =>
            t.aliases.includes(headerKey(c.header)),
          );
          const lock = c.locked;
          const target =
            lock && 'field' in lock
              ? targets.find((t) => t.field.fieldKey === lock.field)
              : !lock && match.length === 1
                ? match[0]
                : undefined;
          const mode = lock?.mode === 'append' ? 'append' : 'field';
          if (target && mode === 'field') used.add(target.ref);
          if (
            blockedCols.has(c.col) ||
            lock?.mode === 'skip' ||
            (mode === 'append' && target?.field.type !== 'TEXTAREA')
          )
            continue;
          if (target && mode === 'field') confirmed.add(target.ref);
          const col: ImportModelColumn = {
            col: c.col,
            header: sourceHeader(
              c.header,
              match.length === 1 ? match[0].field.label : undefined,
            ),
            samples: [],
            values: [],
          };
          if (target) col.locked = { mode, field: target.ref };
          const date =
            target && ['DATE', 'DATETIME'].includes(target.field.type);
          const ambiguous = date
            ? c.samples.filter((v) =>
                /^\s*(?:0?[1-9]|1[0-2])[/. -](?:0?[1-9]|1[0-2])[/. -]\d{4}\s*$/.test(
                  v,
                ),
              )
            : [];
          if (ambiguous.length) formatColumns.add(col);
          col.samples = [
            ...new Set((target ? ambiguous : c.samples).map(sampleShape)),
          ];
          if (!target && (!col.header || col.header === '[文本]')) {
            col.samples = [...new Set(col.samples.map(cellShape))];
            columns.push(col);
            continue;
          }
          for (const v of c.values ?? []) {
            if (
              target &&
              (!target.options.length ||
                target.options.some((o) =>
                  [o.key, o.label].some(
                    (s) => optionKey(s) === optionKey(v.text),
                  ),
                ))
            )
              continue;
            const text = sampleShape(v.text);
            if (!text || text === '[文本]') {
              col.partial = true;
              continue;
            }
            const ref = 'V' + ++valueNumber;
            fileValues.set(ref, v);
            col.values.push({ ref, text, count: v.count });
          }
          if (!target || col.values.length || formatColumns.has(col))
            columns.push(col);
        }
        return { headerRow: row.headerRow, columns };
      }),
  };
  trimInput(input);
  const actionable = (c: ImportModelColumn) =>
    c.locked
      ? c.values.length > 0 || (formatColumns.has(c) && c.samples.length > 0)
      : Boolean(
          (c.header && c.header !== '[文本]') ||
          c.values.length ||
          c.samples.some((s) => s && s !== '[文本]'),
        );
  const headerChoice =
    !req.headerLocked &&
    input.candidates.filter((r) =>
      r.columns.some((c) => c.header && c.header !== '[文本]'),
    ).length > 1;
  return {
    input,
    targets,
    fileValues,
    occupied,
    mapped,
    queryable,
    formatColumns,
    actionable,
    needed:
      input.fields.length > 0 &&
      (headerChoice ||
        input.candidates.some((r) => r.columns.some(actionable))),
  };
}

const envelope = z.object({
  version: z.literal(1),
  headerRow: z.number().int(),
  columns: z.array(z.unknown()).max(80),
  matchFields: z.array(z.unknown()).max(80),
});
const candidateAdvice = columnAdvice.extend({
  values: z.array(z.unknown()).max(100).optional(),
  dateOrder: z.unknown().optional(),
  bareAmountUnit: z.unknown().optional(),
});
const reasons = new Set([
  '名称写法相近',
  '表头含义相近',
  '取值符合字段类型',
  '日期格式相符',
  '金额单位相符',
  '建议人工核对',
  '字段含义相近',
]);
export function readImportPlan(
  state: ReturnType<typeof prepareImport>,
  raw: unknown,
): ImportAssistPlan {
  const { input } = state;
  const plan: ImportAssistPlan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    headerRow: input.currentHeader,
    columns: [],
    matchFields: [],
  };
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return plan;
  const row = input.candidates.find(
    (r) =>
      r.headerRow === parsed.data.headerRow &&
      r.columns.some((c) => c.header || c.locked),
  );
  if (!row) return plan;
  plan.headerRow = row.headerRow;
  const occupied = state.occupied.get(row.headerRow)!;
  const valid: ImportColumnAdvice[] = [];
  for (const item of parsed.data.columns) {
    const result = candidateAdvice.safeParse(item);
    if (!result.success) continue;
    const {
      col,
      target,
      confidence,
      reason,
      dateOrder,
      bareAmountUnit,
      values,
    } = result.data;
    const c = row.columns.find((x) => x.col === col);
    if (!c || !state.actionable(c)) continue;
    const safeReason = reasons.has(reason) ? reason : '建议人工核对';
    if (target.mode === 'skip') {
      if (!c.locked)
        valid.push({ col, target, confidence, reason: safeReason });
      continue;
    }
    const targetField = state.targets.find((t) => t.ref === target.field);
    const dictionary = input.fields.find((t) => t.ref === target.field);
    if (
      !targetField ||
      !dictionary ||
      (target.mode === 'append' && targetField.field.type !== 'TEXTAREA')
    )
      continue;
    if (
      c.locked
        ? target.field !== c.locked.field || target.mode !== c.locked.mode
        : target.mode === 'field' && occupied.has(target.field)
    )
      continue;
    const advice: ImportColumnAdvice = {
      col,
      target: { mode: target.mode, field: targetField.field.fieldKey },
      confidence,
      reason: safeReason,
    };
    if (
      ['DATE', 'DATETIME'].includes(targetField.field.type) &&
      (!c.locked || state.formatColumns.has(c)) &&
      (dateOrder === 'DMY' || dateOrder === 'MDY')
    )
      advice.dateOrder = dateOrder;
    if (
      !c.locked &&
      ['MONEY', 'NUMBER'].includes(targetField.field.type) &&
      (bareAmountUnit === 'yuan' || bareAmountUnit === 'wan')
    )
      advice.bareAmountUnit = bareAmountUnit;
    const choices: NonNullable<ImportColumnAdvice['values']> = [];
    for (const rawValue of values ?? []) {
      const value = valueAdvice.safeParse(rawValue);
      if (!value.success || !targetField.options.length) continue;
      const v = value.data;
      const file = state.fileValues.get(v.value);
      if (
        !file ||
        !c.values.some((x) => x.ref === v.value) ||
        targetField.options.some((o) =>
          [o.key, o.label].some((s) => optionKey(s) === optionKey(file.text)),
        )
      )
        continue;
      const opt = targetField.options.find((o) => o.ref === v.option);
      if (v.option !== null) {
        const label = dictionary.options.find((o) => o.ref === v.option)?.name;
        if (
          !opt ||
          !label ||
          dictionary.options.filter(
            (o) => optionKey(o.name) === optionKey(label),
          ).length !== 1
        )
          continue;
      }
      choices.push({
        value: file.id,
        option: opt?.key ?? null,
        confidence: v.confidence,
      });
    }
    const unique = choices.filter(
      (v) => choices.filter((x) => x.value === v.value).length === 1,
    );
    if (unique.length) advice.values = unique;
    if (!c.locked || advice.dateOrder || advice.values) valid.push(advice);
  }
  plan.columns = valid.filter(
    (v) =>
      valid.filter((x) => x.col === v.col).length === 1 &&
      (v.target.mode !== 'field' ||
        valid.filter(
          (x) =>
            x.target.mode === 'field' &&
            v.target.mode === 'field' &&
            x.target.field === v.target.field,
        ).length === 1),
  );
  for (const ref of new Set(parsed.data.matchFields)) {
    const t = state.targets.find((t) => t.ref === ref);
    if (
      t &&
      input.fields.some((f) => f.ref === ref) &&
      state.queryable.has(t.field.fieldKey) &&
      t.field.type !== 'MULTI_SELECT' &&
      (state.mapped.get(row.headerRow)?.has(t.ref) ||
        plan.columns.some(
          (c) =>
            c.target.mode === 'field' && c.target.field === t.field.fieldKey,
        ))
    )
      plan.matchFields.push(t.field.fieldKey);
    if (plan.matchFields.length === 3) break;
  }
  return plan;
}
