import { Prisma } from '@crm/database';

// Normalize ordinary and financial numerals before validating their place values.
const forms = [
  '零〇',
  '一壹',
  '二两兩贰貳',
  '三叁參',
  '四肆',
  '五伍',
  '六陆陸',
  '七柒',
  '八捌',
  '九玖',
  '十拾',
  '百佰',
  '千仟',
  '万萬',
  '亿億',
];
const canonical = '0123456789十百千万亿';
const numerals = new Map(
  forms.flatMap((group, i) =>
    [...group].map((char) => [char, canonical[i]] as const),
  ),
);
const characters = forms.join('');
export const chineseNumeral = new RegExp('[' + characters + '点點负負]');
const numeralRun = '[' + characters + '点點]+';
export const chineseAmountTokens = new RegExp(
  '[-负負]?' +
    numeralRun +
    '(?:[元圆圓](?:' +
    numeralRun +
    '[角分])*|[角分](?:' +
    numeralRun +
    '分)?)?[整正]?',
  'gu',
);

function integer(text: string): bigint | null {
  for (const [unit, scale] of [
    ['亿', 100000000n],
    ['万', 10000n],
  ] as const) {
    if (!text.includes(unit)) continue;
    const parts = text.split(unit);
    // A bare trailing digit such as 三万六 has an ambiguous place value.
    if (parts.length !== 2 || /^[1-9]$/.test(parts[1])) return null;
    const high = integer(parts[0]);
    const low = parts[1] ? integer(parts[1]) : 0n;
    if (high === null || high === 0n || low === null || low >= scale)
      return null;
    return high * scale + low;
  }

  if (text === '0') return 0n;
  if (!text || /[百千][1-9]$/.test(text)) return null;
  const group =
    /^0?(?:([1-9])千)?(?:0?([1-9])百)?(?:0?([1-9]?)十)?(?:0?([1-9]))?$/.exec(
      text,
    );
  if (!group) return null;
  const [, thousands, hundreds, tens, ones] = group;
  const value =
    Number(thousands ?? 0) * 1000 +
    Number(hundreds ?? 0) * 100 +
    (tens === undefined ? 0 : Number(tens || 1) * 10) +
    Number(ones ?? 0);
  return value ? BigInt(value) : null;
}

/** Convert a complete Chinese currency token into an exact decimal string. */
export function parseChineseAmount(token: string): string | null {
  if (!token || /[0-9]/.test(token)) return null;
  let text = [...token].map((c) => numerals.get(c) ?? c).join('');
  // A standalone 角 or 分 amount has an implicit zero-yuan part.
  text = text.replace(/^([-负負]?)(?=[0-9][角分])/, '$&0元');
  const amount =
    /^([-负負]?)([0-9十百千万亿]+)(?:[点點]([0-9]+)([万亿]?))?(?:[元圆圓](?:([0-9])角)?(?:0?([0-9])分)?[整正]?)?$/.exec(
      text,
    );
  if (!amount) return null;
  const [, negative, whole, fraction, scale, jiao, fen] = amount;
  const value = integer(whole);
  if (value === null || (fraction && (jiao || fen))) return null;
  const places = scale === '亿' ? 8 : scale === '万' ? 4 : 0;
  const decimals = fraction ?? (jiao ?? '0') + (fen ?? '0');
  const sign = negative ? '-' : '';
  return new Prisma.Decimal(
    sign + value.toString() + '.' + decimals + 'e' + places,
  ).toFixed();
}
