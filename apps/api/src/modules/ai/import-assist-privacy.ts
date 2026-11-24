export function headerKey(text: string) {
  return text
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[.:;,!?。、]+$/u, '')
    .toLowerCase();
}
export const reservedHeadings = [
  '记录编号',
  '创建时间',
  '更新时间',
  '创建人',
  '更新人',
  '负责人',
  '跟进人',
  '跟单人',
  '销售',
  '业务员',
  '归属',
  '经办人',
  'owner',
  'assignee',
  'salesperson',
  'salesrep',
  'recordNo',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'ownerMemberId',
  'ownerId',
  'memberId',
  'userId',
  'tenantId',
  'workflowStateKey',
].map(headerKey);
const owner =
  /负责人|跟进人|跟单人|销售|业务员|归属|经办人|owner|assignee|salesperson|salesrep/i;
const sensitive =
  /密码|密钥|令牌|凭据|password|secret|credential|token|cookie|session|apikey|privatekey/i;
export function restrictedLabel(label: string) {
  const key = headerKey(label).replace(/[_-]/g, '');
  return (
    owner.test(key) ||
    sensitive.test(key) ||
    /^(recordno|createdat|updatedat|createdby|updatedby|ownerid|memberid|userid|tenantid|workflowstatekey)$/.test(
      key,
    )
  );
}

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
// Only known business-label tokens can turn an unknown cell into a heading.
// Titles, notes and unrecognized names contribute shape alone.
const headerWords = new Set(
  (
    '客户 公司 企业 单位 组织 联系人 联系 客户方 线索 项目 商机 合同 订单 业务 预计 成交 预算 意向 签约 回款 跟进 创建 最近 最后 首次 拜访 访问 购买 计划 下次 注册 英文 中文 所属 评级 评级结果 等级 级别 类别 分类 类型 来源 渠道 状态 阶段 名称 全称 简称 名字 姓名 电话 座机 手机 号码 邮箱 邮件 地址 编号 编码 代码 日期 时间 金额 单价 数额 万元 万 人民币 元 备注 描述 说明 评价 反馈 行业 地区 省份 城市 标签 优先级 数量 是否 有效 启用 重要 星级 分级 重点 旧 原 客户名 ' +
    'company customer client organization account contact business full name title code id phone tel mobile email mail address industry date time amount price budget value level tier grade rating status stage source channel category type note notes remark description comment comments feedback priority region city tag rmb cny'
  ).split(' '),
);
// A bounded segmentation table handles overlapping words in linear time for a fixed dictionary.
function businessHeader(raw: string) {
  const value = raw.toLowerCase().replace(/[\s_()/（）-]/gu, '');
  if (!value || value.length > 40) return false;
  const ends = new Set([0]);
  for (let i = 0; i < value.length; i++) {
    if (ends.has(i))
      for (const word of headerWords)
        if (value.startsWith(word, i)) ends.add(i + word.length);
  }
  return ends.has(value.length);
}
export function sourceHeader(raw: string, knownLabel?: string) {
  if (knownLabel) return dictionaryLabel(knownLabel);
  const clean = mask(raw);
  if (!clean) return '';
  return clean.length <= 40 && businessHeader(clean)
    ? compact(clean)
    : '[文本]';
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
