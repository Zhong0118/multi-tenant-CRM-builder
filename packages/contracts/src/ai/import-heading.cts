export function headerKey(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[.:;,!?。、]+$/u, "")
    .toLowerCase();
}
export const reservedHeadings = [
  "记录编号",
  "创建时间",
  "更新时间",
  "创建人",
  "更新人",
  "负责人",
  "跟进人",
  "跟单人",
  "销售",
  "业务员",
  "归属",
  "经办人",
  "owner",
  "assignee",
  "salesperson",
  "salesrep",
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
const owner =
  /负责人|跟进人|跟单人|销售|业务员|归属|经办人|owner|assignee|salesperson|salesrep/i;
const sensitive =
  /密码|密钥|令牌|凭据|password|secret|credential|token|cookie|session|apikey|privatekey/i;
export function restrictedLabel(label: string) {
  const key = headerKey(label).replace(/[_-]/g, "");
  return (
    reservedHeadings.includes(headerKey(label)) ||
    owner.test(key) ||
    sensitive.test(key) ||
    /^(recordno|createdat|updatedat|createdby|updatedby|ownerid|memberid|userid|tenantid|workflowstatekey)$/.test(
      key,
    )
  );
}

// Both the browser preview and the provider boundary project the physical source
// label. A selected header can contain unfamiliar business vocabulary.
const numbers = /\+?\(?\d(?:[\s(),.\-–—]*\d){6,}[xX]?/g;
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
    .replace(numbers, maskImportNumber);
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

export function projectImportHeading(raw: string, confirmed: boolean): string {
  if (confirmed) return maskImportLabel(raw);
  const s = raw.trim().normalize("NFKC");
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
  // Common surnames also occur inside ordinary nouns (成交、金额、方式).
  // Remove those nouns before looking for a surname followed by a given name.
  const nameContext = s
    .replace(/[ _/-]+/g, "")
    .replace(
      /签单|订单|成交|成本|金额|金融|现金|商机|商务|商品|商户|客商|业务|方式|方案|方向|单位|单价|数量|号码|代码|编号|编码|名称|姓名|日期|时间|字段|万元|百万|城市|地区|优先级|历史|公司|行业|联系人/g,
      " ",
    );
  if (surname.test(nameContext)) return "";
  // Short English names and prose can otherwise resemble multi-word captions.
  if (/^[A-Za-z]/.test(s)) {
    const words = s.split(/[ _/-]+/);
    if (
      words.length > 5 ||
      ((words.length > 1 || /^[A-Z][a-z]+$/.test(s)) &&
        !englishDescriptor.test(words.join(" ")))
    )
      return "";
    if (
      words.some(
        (word, i) =>
          /^[A-Z][a-z]+$/.test(word) &&
          /^[A-Z][a-z]+$/.test(words[i + 1] ?? "") &&
          !englishDescriptor.test(word) &&
          !englishDescriptor.test(words[i + 1]!),
      )
    )
      return "";
  }
  return maskImportLabel(raw);
}
