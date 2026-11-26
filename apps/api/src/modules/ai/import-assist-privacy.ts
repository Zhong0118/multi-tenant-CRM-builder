import {
  importScalarSample,
  projectImportHeading,
} from '@crm/contracts/import-heading';
export function dictionaryLabel(raw: string) {
  return projectImportHeading(raw, true);
}
export function sampleShape(raw: string) {
  return importScalarSample(raw) ?? (raw.trim() ? '[文本]' : '');
}

export function cellShape(safe: string) {
  if (!safe) return '';
  if (safe.includes('@') || safe === '[邮箱]') return '[邮箱]';
  if (safe.includes('****') || safe === '[号码]') return '[号码]';
  if (/^\d+[年./-]\d+[月./-]\d+/.test(safe)) return '[日期]';
  if (/^[¥￥+-]?\d/.test(safe)) return '[数值]';
  return '[文本]';
}
