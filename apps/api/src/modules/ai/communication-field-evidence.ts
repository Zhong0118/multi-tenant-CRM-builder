import { Prisma } from '@crm/database';
import type { CommunicationField } from './communication-draft-generator';

const override =
  /(?:忽略|无视|绕过).{0,16}(?:指令|要求|规则|权限)|\b(?:ignore|override)\b.{0,32}\b(?:instructions?|rules?|permissions?)\b/iu;
const editInstruction = /(?:请|把|将).{0,24}(?:改成|改为|设为|设置为|标记为)/u;
const uncertain =
  /并非|不是|尚未|还未|还没|没有|如果|假如|可能|尚待|\b(?:not|if|might|no)\b/iu;
const closingLabel = /^(?:已)?(?:成交|签约|签单)$/u;
const signed = /签了|已(?:经)?签(?:约|署|单)|合同已签|签约完成/u;
const signedBusiness =
  /签了(?:合同|订单|采购单|销售协议|$)|合同.{0,4}已签|已签(?:约|单)|签约完成|已签署(?:合同|订单)/u;

function mentions(text: string, label: string) {
  return /^[a-z0-9_-]+$/iu.test(label)
    ? text
        .toLowerCase()
        .split(/[^a-z0-9_-]+/iu)
        .includes(label.toLowerCase())
    : text.includes(label);
}

function numericEvidence(
  field: CommunicationField,
  value: unknown,
  clause: string,
  quoteFrom: number,
  quoteTo: number,
) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (
    field.type === 'MONEY' &&
    !clause.includes(field.label) &&
    !clause.includes(field.fieldKey) &&
    !/金额|预算|价格|报价|款项|总价|合同额|元|[￥¥$]/u.test(clause)
  )
    return false;
  const matches = [
    ...clause.matchAll(
      /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*([千万亿]))?/gu,
    ),
  ].filter(
    (match) =>
      match.index >= quoteFrom && match.index + match[0].length <= quoteTo,
  );
  if (matches.length !== 1) return false;
  const [raw, unit] = matches[0];
  const digits = raw.replace(/[,\s千万亿]/gu, '');
  const power = unit === '亿' ? 8 : unit === '万' ? 4 : unit === '千' ? 3 : 0;
  return new Prisma.Decimal(digits + 'e' + power).equals(value);
}

/** Check the untrimmed source clause as well as the model's quote so it cannot
 * turn a negation, instruction, or part of a number into positive evidence. */
export function supportsCommunicationFieldChange(
  field: CommunicationField,
  value: unknown,
  evidence: string,
  content: string,
  editableFields: CommunicationField[],
): boolean {
  const start = content.indexOf(evidence);
  if (start < 0 || !evidence.trim() || override.test(content)) return false;
  const end = start + evidence.length;
  for (const { 0: clause, index } of content.matchAll(
    /[^，。；;！？!?\n]+/gu,
  )) {
    const from = Math.max(0, start - index);
    const to = Math.min(clause.length, end - index);
    if (from >= to || editInstruction.test(clause)) continue;
    const quote = clause.slice(from, to);
    if (value === null) {
      if (quote.includes(field.label) && /清空|已清除/u.test(quote))
        return true;
      continue;
    }
    if (field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT') {
      const keys = Array.isArray(value) ? value : [value];
      if (
        keys.length &&
        keys.every((key) => {
          const option = field.options?.find((o) => o.key === key);
          if (!option || uncertain.test(clause.replaceAll(option.label, '')))
            return false;
          return (
            mentions(quote, option.label) ||
            mentions(quote, option.key) ||
            (closingLabel.test(option.label) &&
              signed.test(quote) &&
              signedBusiness.test(clause.trim()) &&
              field.options?.filter((o) => closingLabel.test(o.label))
                .length === 1)
          );
        })
      )
        return true;
    } else if (field.type === 'NUMBER' || field.type === 'MONEY') {
      const peers = editableFields.filter((other) => other.type === field.type);
      if (peers.length > 1) {
        const named = peers.filter(
          (other) =>
            mentions(clause, other.label) || mentions(clause, other.fieldKey),
        );
        if (named.length !== 1 || named[0].fieldKey !== field.fieldKey)
          continue;
      }
      if (
        !uncertain.test(clause) &&
        numericEvidence(field, value, clause, from, to)
      )
        return true;
    } else if (['TEXT', 'TEXTAREA', 'PHONE', 'EMAIL'].includes(field.type)) {
      if (
        typeof value === 'string' &&
        quote.toLowerCase().includes(value.toLowerCase())
      )
        return true;
    } else {
      // Member resolution and the remaining scalar types use their existing
      // schema validators and must also cite actual source text.
      return true;
    }
  }
  return false;
}
