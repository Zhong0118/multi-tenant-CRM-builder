// Unknown text (including plausible personal names and workbook titles) stays local.
const labelWords =
  /(?:客户|单位|企业|公司|联系|意向|业务|成交|预计|合同|订单|销售|线索|来源|跟进|联系|创建|签约|项目|渠道|客户名|全称|简称|名称|电话|手机|号码|编号|编码|代码|评级|级别|等级|分级|分类|类型|状态|阶段|日期|时间|金额|预算|单价|数额|万元|万|元|地区|省份|城市|行业|标签|备注|描述|评价|地址|邮箱|邮件|网址|是否|有效|启用|重点|优先级|company|account|customer|contact|business|client|full|name|phone|mobile|email|id|code|amount|budget|date|time|stage|status|level|tier|grade|tag|type|source|channel|notes?|remark|value|region|industry|priority|rmb|cny|[()（）_ /-])/iy;
export function businessLabel(s: string) {
  if (s.length > 80) return false;
  labelWords.lastIndex = 0;
  while (labelWords.lastIndex < s.length) if (!labelWords.test(s)) return false;
  return s.length > 0;
}
