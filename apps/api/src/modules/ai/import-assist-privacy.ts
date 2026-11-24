// Recognize the whole identifier before truncation. Unclassifiable long digit
// groups get a single mask as well, including international prefixes and IDs.
function mask(raw: string) {
  const normalized = raw
    .normalize('NFKC')
    .trim()
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ');
  if (normalized.includes('@')) {
    const address =
      /^([a-z\d])[\w.%+*-]*@([a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,})$/i.exec(
        normalized,
      );
    return address ? address[1] + '***@' + address[2] : '[邮箱]';
  }
  return normalized.replace(/\+?\(?\d(?:[\s().\-–—]*\d){6,}[xX]?/g, (match) => {
    const digits = match
      .replace(/\D/g, '')
      .replace(/^(?:0086|86)(?=1[3-9]\d{9}$|0\d{9,11}$)/, '');
    if (/^1[3-9]\d{9}$/.test(digits))
      return digits.slice(0, 3) + '****' + digits.slice(-4);
    const landline = /^(0(?:10|2\d|[3-9]\d{2}))\d{7,8}$/.exec(digits);
    return landline ? landline[1] + '-****' + digits.slice(-4) : '[号码]';
  });
}
const compact = (text: string) => [...text].slice(0, 40).join('');
export function dictionaryLabel(raw: string) {
  return compact(mask(raw));
}
const enumWord =
  /^(?:[A-F][+-]?(?:类|级|档)?|[一二三四五1-5](?:级|星|类|档)|(?:高|中|低|普通|重点|核心|潜在|重要|战略)(?:客户|优先级)?|是|否|有|无|已成交|未成交|跟进中|未联系|展会|线上|线下|转介绍|未知|其他|high|medium|low|yes|no|true|false)$/i;
export function sampleShape(raw: string) {
  const clean = raw.normalize('NFKC').trim();
  if (!clean) return '';
  if (
    /^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(
      clean,
    )
  )
    return compact(clean);
  const safe = mask(clean);
  const contact = safe.match(
    /(?:1[3-9]\d\*{4}\d{4}|0\d{2,3}-\*{4}\d{4}|[a-z\d]\*{3}@[a-z\d.-]+\.[a-z]{2,})/i,
  );
  if (contact) return compact(contact[0]);
  if (safe.includes('[号码]') || safe.includes('[邮箱]'))
    return safe.includes('[邮箱]') ? '[邮箱]' : '[号码]';
  if (
    /^[¥￥+-]?\d{1,6}(?:\.\d{1,4})?(?:万元?|亿元?|元)?$/.test(clean) ||
    enumWord.test(clean)
  )
    return compact(clean);
  return '[文本]';
}

export function cellShape(safe: string) {
  if (!safe) return '';
  if (safe.includes('@') || safe === '[邮箱]') return '[邮箱]';
  if (safe.includes('****') || safe === '[号码]') return '[号码]';
  if (/^\d+[年./-]\d+[月./-]\d+/.test(safe)) return '[日期]';
  if (/^[¥￥+-]?\d/.test(safe)) return '[数值]';
  return '[文本]';
}
