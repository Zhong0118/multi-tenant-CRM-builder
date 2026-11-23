import { randomUUID } from 'node:crypto';
import type { TableBlueprint, TablePlan } from '@crm/contracts';
import {
  allocateSuggestedCode,
  builtInReason,
  canonicalName,
} from './table-blueprint';
import type { TableModelOutput } from './table-model';

type Omission = TableBlueprint['omitted'][number];
type ModelOmission = TableModelOutput['omitted'][number];

// Old model responses sometimes restate a field label in prose. Recover it only
// when both the request and alternative name the same field. Exact labels take
// precedence, so operands of a formula remain ordinary fields.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
function mentions(text: string) {
  const edges = new Set([...segmenter.segment(text)].map((part) => part.index));
  edges.add(text.length);
  return (label: string) => {
    let start = text.indexOf(label);
    while (start >= 0) {
      if (edges.has(start) && edges.has(start + label.length)) return true;
      start = text.indexOf(label, start + 1);
    }
    return false;
  };
}
function matchingFields(item: ModelOmission, tables: TablePlan[]) {
  const request = canonicalName(item.request);
  const alternative = canonicalName(item.alternative ?? '');
  const fields = tables.flatMap((table) =>
    table.fields.map((field) => ({ table, field })),
  );
  const exact = fields.filter(
    ({ field }) => canonicalName(field.label) === request,
  );
  if (exact.length) return exact;
  const named = fields.filter(
    ({ field }) =>
      item.manualField &&
      canonicalName(field.label) === canonicalName(item.manualField.label),
  );
  const inRequest = mentions(request);
  if (named.length && inRequest(canonicalName(item.manualField!.label)))
    return named;
  const inAlternative = mentions(alternative);
  const requested = fields.filter(({ field }) =>
    inRequest(canonicalName(field.label)),
  );
  const corroborated = requested.filter(({ field }) =>
    inAlternative(canonicalName(field.label)),
  );
  // Resolve a conflicting manual-field hint against the request. A global
  // workflow can also mention an input field; it alone does not identify a substitute.
  const mentioned =
    corroborated.length || !item.manualField
      ? corroborated
      : requested.filter(({ field }) => {
          const name = canonicalName(field.label);
          return request.startsWith(name) || request.endsWith(name);
        });
  if (!mentioned.length) return named;
  // Do not let a shorter label embedded in the full field name match as well.
  return mentioned.filter(
    ({ field }) =>
      !mentioned.some(
        ({ field: other }) =>
          canonicalName(other.label) !== canonicalName(field.label) &&
          canonicalName(other.label).includes(canonicalName(field.label)),
      ),
  );
}

export function normalizeOmissions(
  raw: ModelOmission[],
  tables: TablePlan[],
  previous: Omission[] = [],
  previousTable?: TablePlan,
  existingKeys: string[] = [],
): Omission[] {
  const omitted = [...previous];
  for (const item of raw) {
    const scope = item.tableName
      ? tables.filter(
          (table) =>
            canonicalName(table.name) === canonicalName(item.tableName!),
        )
      : tables;
    const matches = matchingFields(item, scope);
    if (
      matches.length > 1 ||
      (item.manualField && !matches.length && scope.length !== 1) ||
      (item.tableName && !scope.length && matchingFields(item, tables).length)
    ) {
      const alternative = '可能有替代字段，所属表或字段不明确，请确认。';
      if (
        !omitted.some(
          (o) =>
            !o.tableId &&
            o.request === item.request &&
            o.alternative === alternative,
        )
      )
        omitted.push({
          request: item.request,
          reason: item.reason,
          alternative,
        });
      continue;
    }
    const found = matches[0];
    const table =
      found?.table ??
      ((item.tableName || item.manualField) && scope.length === 1
        ? scope[0]
        : undefined);
    const label = found?.field.label ?? item.manualField?.label;
    const manual = label && table && !builtInReason(label);
    const existing = omitted.find(
      (o) =>
        o.tableId === table?.id &&
        (canonicalName(o.request) === canonicalName(item.request) ||
          (manual &&
            o.manualField &&
            canonicalName(o.manualField.label) === canonicalName(label))),
    );
    if (existing?.manualField) continue;
    const entry: Omission = existing ?? {
      request: item.request,
      reason: item.reason,
    };
    if (table) entry.tableId = table.id;
    if (item.alternative) entry.alternative = item.alternative;
    if (manual) {
      const id = found?.field.id ?? randomUUID();
      entry.manualField = {
        id,
        fieldKey:
          found?.field.fieldKey ??
          allocateSuggestedCode(
            item.manualField?.fieldKey ?? '',
            id,
            'field',
            new Set([
              ...existingKeys,
              ...table.fields.map((f) => f.fieldKey),
              ...omitted.flatMap((o) =>
                o.tableId === table.id && o.manualField
                  ? [o.manualField.fieldKey]
                  : [],
              ),
            ]),
          ),
        label,
        type: found?.field.type ?? item.manualField!.type,
        ...(found?.field.options ? { options: found.field.options } : {}),
        ...(found?.field.validation
          ? { validation: found.field.validation }
          : {}),
        required: false,
        reason: '由管理员选择后手动录入。',
      };
    }
    if (!existing) omitted.push(entry);
  }

  for (const table of tables) {
    const deferred = omitted.filter(
      (o) => o.tableId === table.id && o.manualField,
    );
    const removed = new Set<string>();
    table.fields = table.fields.filter((f) => {
      const item = deferred.find(
        (o) => canonicalName(o.manualField!.label) === canonicalName(f.label),
      );
      if (!item) return true;
      // A refinement may preserve a field explicitly restored in the submitted plan.
      if (
        item.manualField!.id === f.id &&
        previousTable?.fields.some((p) => p.id === f.id) &&
        previous.some((o) => o.manualField?.id === f.id)
      )
        return true;
      removed.add(f.id);
      return false;
    });
    if (removed.has(table.titleFieldId)) table.titleFieldId = '';
    table.view.columnIds = table.view.columnIds.filter(
      (id) => !removed.has(id),
    );
  }
  return omitted;
}
