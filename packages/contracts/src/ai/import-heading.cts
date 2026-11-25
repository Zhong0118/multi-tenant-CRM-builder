export function headerKey(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[.:;,!?。、]+$/u, "")
    .toLowerCase();
}
const physicalKey = (text: string) =>
  headerKey(text).replace(/[\p{P}\s]/gu, "");
const ownerHeadings = new Set([
  "负责人",
  "跟进人",
  "跟单人",
  "业务员",
  "经办人",
  "销售员",
  "销售人员",
  "销售代表",
  "所属销售",
  "归属人",
  "归属销售",
  "owner",
  "assignee",
  "salesperson",
  "salesrep",
]);
export function ownerHeading(label: string) {
  return ownerHeadings.has(physicalKey(label));
}
export const reservedHeadings = [
  ...ownerHeadings,
  "销售",
  "归属",
  "记录编号",
  "创建时间",
  "更新时间",
  "创建人",
  "更新人",
  "recordNo",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "ownerMemberId",
  "ownerId",
  "memberId",
  "userId",
  "tenantId",
  "workflowStateKey",
].map(headerKey);
const sensitive =
  /非公开|机密|保密|密码|密钥|令牌|凭据|password|secret|credential|token|cookie|session|apikey|privatekey/i;
export function restrictedLabel(label: string) {
  const key = physicalKey(label);
  return reservedHeadings.includes(key) || sensitive.test(key);
}

// Both the browser preview and the provider boundary project the physical source
// label. A selected header can contain unfamiliar business vocabulary.
const numbers =
  /1[3-9]\d\*{4}\d{4}|0\d{2,3}-\*{4}\d{4}|\+?\(?\d(?:[\s(),.\-–—]*\d){6,}[xX]?|\d{3,}/g;
const email = /[\w.%+*-]+@(?:[a-z\d-]+\.)+[a-z]{2,}/gi;

export function maskImportNumber(raw: string) {
  const digits = raw
    .replace(/\D/g, "")
    .replace(/^(?:0086|86)(?=1[3-9]\d{9}$|0\d{9,11}$)/, "");
  if (/^1[3-9]\d{9}$/.test(digits))
    return digits.slice(0, 3) + "****" + digits.slice(-4);
  const area = /^(0(?:10|2\d|[3-9]\d{2}))\d{7,8}$/.exec(digits);
  return area ? area[1] + "-****" + digits.slice(-4) : "[号码]";
}

export function maskImportLabel(raw: string) {
  const clean = raw.trim().replace(/[\p{Cc}\p{Cf}]/gu, " ");
  const normalized = clean.normalize("NFKC");
  const masked = normalized
    .replace(email, (address) => address[0] + "***@" + address.split("@")[1])
    .replace(numbers, (number) =>
      number.includes("****") ? number : maskImportNumber(number),
    );
  // Keep business punctuation and spelling when normalization only served detection.
  return Array.from(masked === normalized ? clean : masked)
    .slice(0, 40)
    .join("");
}

const surname =
  /(?:欧阳|司马|上官|诸葛|慕容|[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛范彭郎鲁韦昌马苗方俞任袁柳鲍史唐费薛雷贺倪汤殷罗毕郝安常傅康伍余顾孟黄穆萧尹姚邵汪祁毛禹狄戴宋庞熊舒屈项董梁杜阮蓝季贾江童颜郭林钟徐邱骆高夏蔡田胡凌霍虞万柯卢巩程陆翁丁邓洪包左石崔龚刘黎叶曾廖谭邝卓成商单])\p{Script=Han}/u;
const nonHeading =
  /(?:ignore|disregard|override|prompt|instruction|system message|return json|\b(?:i|me|we|you|they|he|she|my|our|please|send|ignore|call|must|should|would|agreed|told|wants?|needs?)\b|忽略|指令|提示词|执行|输出|不要|请|务必|所有规则|点击|返回|跳过|这[是个份张]|[我您你他她们]|已经|本周|今天|明天|需要|正在|仍在|的是|的|给|汇总|周报|月报|清单|明细表|报表|填制|制表|内部资料|有限公司|集团公司|分公司|分店|商社|公司$|集团$|有限责任|股份有限|(?:市|县|路|街|号楼|室)$)/i;
const dataValue =
  /^(?:[A-F][+-]?(?:级|档|类)?|高|中|低|重点|普通|未知|其他|是|否|有|无|待定|(?:重点|普通|潜在|意向|成交|老|新)客户|未评级|线上|线下|展会|转介绍|已联系|未联系|已成交|未成交|true|false|yes|no|null|n\/a)$/i;
const englishDescriptor =
  /\b(?:name|label|code|date|time|amount|price|cost|value|contact|phone|email|status|stage|probability|rating|source|channel|type|address|company|customer|account|contract|order|reference|number|description|note|field|priority|region|category|title|industry|budget|grade|tier|level|remark|tag|key|id)\b/i;

function personalText(s: string) {
  // Common surnames also occur inside ordinary nouns (成交、金额、方式).
  // Remove those nouns before looking for a surname followed by a given name.
  const nameContext = s
    .replace(/[ _/-]+/g, "")
    .replace(
      /选项|项目|签单|订单|成交|成本|金额|金融|现金|商机|商务|商品|商户|客商|业务|方式|方案|方向|单位|单价|数量|号码|代码|编号|编码|名称|姓名|日期|时间|字段|万元|百万|城市|地区|优先级|历史|公司|行业|联系人/g,
      " ",
    );
  if (surname.test(nameContext)) return true;
  const words = s.split(/[^a-z]+/i).filter(Boolean);
  return words.some(
    (word, i) =>
      /^[A-Z][a-z]+$/.test(word) &&
      !englishDescriptor.test(word) &&
      (words.length === 1 ||
        (/^[A-Z][a-z]+$/.test(words[i + 1] ?? "") &&
          !englishDescriptor.test(words[i + 1]!))),
  );
}

export function projectImportHeading(raw: string, confirmed: boolean): string {
  const s = raw.trim().normalize("NFKC");
  if (personalText(s)) return "";
  if (confirmed) return maskImportLabel(raw);
  if (
    !s ||
    Array.from(s).length > 40 ||
    /^\p{Script=Han}$/u.test(s) ||
    !/\p{L}/u.test(s) ||
    !/^[\p{L}\p{N} ()_/％%\-]+$/u.test(s) ||
    /\d{2,}|^\d|@|\*|[\r\n]/.test(s) ||
    nonHeading.test(s) ||
    dataValue.test(s)
  )
    return "";
  // Short English names and prose can otherwise resemble multi-word captions.
  if (/^[A-Za-z]/.test(s)) {
    const words = s.split(/[ _/-]+/);
    if (
      words.length > 5 ||
      ((words.length > 1 || /^[A-Z][a-z]+$/.test(s)) &&
        !englishDescriptor.test(words.join(" ")))
    )
      return "";
  }
  return maskImportLabel(raw);
}

// Only a categorical heading can authorize value samples from an unmapped column.
// Ambiguous schema matches remain manual until a target is selected.
const enumKinds = [
  /等级|级别|评级|分级|分层|层级|档位|优先级|(?:level|grade|rank|rating|tier|priority)$/i,
  /标签|标记|(?:tags?|labels?)$/i,
  /状态|阶段|进度|(?:status|stage|phase)$/i,
  /渠道|来源|(?:source|channel)$/i,
  /类别|分类|类型|分组|(?:category|type|group|class)$/i,
];
export function candidateEnumField<
  T extends { fieldKey: string; label: string; type: string },
>(header: string, fields: T[]): T | undefined {
  const key = headerKey(header);
  const kind = enumKinds.find((re) => {
    const match = re.exec(key);
    return match && match.index + match[0].length === key.length;
  });
  if (!kind || !projectImportHeading(header, false)) return;
  const enums = fields.filter(
    (f) => f.type === "SINGLE_SELECT" || f.type === "MULTI_SELECT",
  );
  const matches = enums.filter(
    (f) => kind.test(f.label) || kind.test(f.fieldKey),
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length && enums.length === 1) return enums[0];
}

// Contacts are recognized before length checks so that a long phone number
// or address is never exposed by slicing through the middle of the identifier.
export function importScalarSample(raw: string): string | undefined {
  const text = raw.trim().normalize("NFKC");
  if (!text) return;
  if (
    /^(?:1[3-9]\d\*{4}\d{4}|0\d{2,3}-\*{4}\d{4}|\[号码\]|\[邮箱\])$/.test(text)
  )
    return text;
  if (text.includes("@")) {
    const address =
      /^([a-z\d])[\w.%+*-]*@([a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]{2,})$/i.exec(
        text,
      );
    return address
      ? address[1] + "***@" + address[2]!.replace(/\d{3,}/g, "***").slice(0, 35)
      : "[邮箱]";
  }
  if (
    /^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(
      text,
    )
  )
    return text;
  if (
    /^[+(\d][\d\s()+,.\-–—]*[\dxX]$/.test(text) &&
    text.replace(/\D/g, "").length >= 7
  )
    return maskImportNumber(text);
  if (/^[¥￥+\-]?\d{1,6}(?:[,.]\d{1,6})*(?:[万亿]?元?)?$/.test(text))
    return text.replace(/\d{3,}/g, "***");
}
export function importEnumAlias(raw: string): string | undefined {
  const text = raw.trim().normalize("NFKC");
  if (
    !text ||
    Array.from(text).length > 20 ||
    /[\r\n]/.test(raw) ||
    /^(?:nan|#?n\/a|null)$/i.test(text)
  )
    return;
  // A masked address/phone is safe on both projections, including the API's
  // second pass over a browser-sanitized value.
  const scalar = importScalarSample(text);
  if (
    scalar &&
    (scalar.includes("@") ||
      scalar.includes("****") ||
      /^\[(号码|邮箱)\]$/.test(scalar))
  )
    return scalar;
  if (nonHeading.test(text)) return;
  if (!/^[\p{L}\p{N} _+*\-/]+$/u.test(text) || personalText(text)) return;
  return text.replace(/\d{3,}/g, "***");
}
