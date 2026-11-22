import { Prisma } from '@crm/database';

export function isSourceQuote(quote: string, source: string) {
  return !!quote.trim() && source.includes(quote);
}

/** Compare the whole numeric token, including its scale, with the normalized CRM value. */
export function isQuotedNumber(value: unknown, quote: string, source: string) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const start = source.indexOf(quote);
  if (start < 0 || !quote.trim()) return false;
  const end = start + quote.length;
  const tokens =
    /([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+))(?:[eE]([+-]?\d+))?(?:\s*([千万亿]))?/gu;
  for (const match of source.matchAll(tokens)) {
    if (match.index < start || match.index + match[0].length > end) continue;
    const digits = match[1].replaceAll(',', '');
    const scale =
      match[3] === '亿' ? 8 : match[3] === '万' ? 4 : match[3] === '千' ? 3 : 0;
    const exponent = Number(match[2] ?? 0) + scale;
    if (
      Number.isSafeInteger(exponent) &&
      new Prisma.Decimal(digits + 'e' + exponent).equals(value)
    )
      return true;
  }
  return false;
}
