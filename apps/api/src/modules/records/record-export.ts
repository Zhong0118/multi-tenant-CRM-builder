export const RECORD_EXPORT_MAX_ROWS = 5000;

export interface ExportField {
  fieldKey: string;
  label: string;
  type: string;
  config: Record<string, unknown>;
}

export interface ExportRecord {
  recordNo: string;
  ownerMemberId: string | null;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function buildRecordExportCsv(input: {
  fields: ExportField[];
  records: ExportRecord[];
  memberNames: Map<string, string>;
}): string {
  const columns = [
    { key: 'recordNo', header: '业务编号' },
    { key: 'owner', header: '负责人' },
    ...input.fields.map((field) => ({
      key: field.fieldKey,
      header: field.label,
    })),
    { key: 'createdAt', header: '创建时间' },
    { key: 'updatedAt', header: '最近更新' },
  ];
  const lines = [
    columns.map((column) => csvCell(column.header)).join(','),
    ...input.records.map((record) =>
      columns
        .map((column) =>
          csvCell(
            exportColumn(column.key, record, input.fields, input.memberNames),
          ),
        )
        .join(','),
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportFileName(objectName: string, objectCode: string): string {
  const base = objectName.trim() || objectCode;
  return `${base.replace(/[/\\?%*:|"<>]/g, '_')}.csv`;
}

function exportColumn(
  key: string,
  record: ExportRecord,
  fields: ExportField[],
  memberNames: Map<string, string>,
): string {
  if (key === 'recordNo') return record.recordNo;
  if (key === 'owner') {
    return record.ownerMemberId
      ? (memberNames.get(record.ownerMemberId) ?? record.ownerMemberId)
      : '未指定';
  }
  if (key === 'createdAt' || key === 'updatedAt') {
    return formatDateTime(record[key]);
  }
  const field = fields.find((candidate) => candidate.fieldKey === key);
  if (!field) return '';
  return formatExportValue(field, record.values[key], memberNames);
}

export function formatExportValue(
  field: ExportField,
  value: unknown,
  memberNames: Map<string, string>,
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'BOOLEAN':
      return value === true ? '是' : value === false ? '否' : '';
    case 'SINGLE_SELECT':
      return optionLabel(field, String(value));
    case 'MULTI_SELECT':
      return (Array.isArray(value) ? value : [])
        .map((key) => optionLabel(field, String(key)))
        .join('；');
    case 'MEMBER':
      return typeof value === 'string' ? (memberNames.get(value) ?? value) : '';
    case 'DATETIME':
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

function optionLabel(field: ExportField, key: string): string {
  const options = field.config.options;
  if (!Array.isArray(options)) return key;
  for (const option of options) {
    if (
      option &&
      typeof option === 'object' &&
      !Array.isArray(option) &&
      (option as { key?: unknown }).key === key &&
      typeof (option as { label?: unknown }).label === 'string'
    ) {
      return (option as { label: string }).label;
    }
  }
  return key;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);
}

function csvCell(value: string): string {
  const firstContent = [...value].find(
    (character) => character.trim() !== '' && character.charCodeAt(0) > 31,
  );
  if (
    (firstContent !== undefined && '=+@-'.includes(firstContent)) ||
    ['\t', '\r', '\n'].some((character) => value.startsWith(character))
  )
    value = `'${value}`;
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
