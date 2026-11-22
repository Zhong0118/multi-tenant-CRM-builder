import { Prisma } from '@crm/database';
import {
  chineseAmountTokens,
  chineseNumeral,
  parseChineseAmount,
} from './chinese-amount';

export function isSourceQuote(quote: string, source: string) {
  return !!quote.trim() && source.includes(quote);
}

/** Compare the whole numeric token, including its scale, with the normalized CRM value. */
export function isQuotedNumber(value: unknown, quote: string, source: string) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (!isSourceQuote(quote, source)) return false;
  const tokens =
    /([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+))(?:[eE]([+-]?\d+))?(?:\s*([千万亿]))?/gu;
  function isWholeQuotedToken(match: RegExpExecArray) {
    const after = match.index + match[0].length;
    // A repeated quote can be a suffix of one amount and a complete amount elsewhere.
    const start = source.indexOf(quote, Math.max(0, after - quote.length));
    if (start < 0 || start > match.index) return false;
    const adjacent = (source[match.index - 1] ?? '') + (source[after] ?? '');
    return !chineseNumeral.test(adjacent) && !/\d/.test(adjacent);
  }
  for (const match of source.matchAll(tokens)) {
    if (!isWholeQuotedToken(match)) continue;
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
  for (const match of source.matchAll(chineseAmountTokens)) {
    if (!isWholeQuotedToken(match)) continue;
    const normalized = parseChineseAmount(match[0]);
    if (normalized !== null && new Prisma.Decimal(normalized).equals(value))
      return true;
  }
  return false;
}
