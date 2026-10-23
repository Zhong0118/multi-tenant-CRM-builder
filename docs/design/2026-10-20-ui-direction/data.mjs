// One scenario, written once, shared by all three directions: the 客户 table of
// 星云科技, the open record 澜庭智能科技（杭州）, and the 客户 field configuration.
// Only content lives here. Each direction's markup and styles are written separately.

export const company = { name: '星云科技', mark: '星' };
export const me = { name: '陈静', role: '公司管理员' };

// Stable hue per person so the same member looks the same everywhere.
export const OWNER_HUE = { 赵晨: 172, 孙悦: 215, 钱宇: 285, 周岚: 28, 吴桐: 140, 王宁: 340, 郑凯: 45, 李昂: 250, 陈静: 200 };

export const nav = [
  { group: '工作', items: [
    { icon: 'home', label: '管理工作台' },
    { icon: 'todo', label: '跟进待办', badge: '3' },
    { icon: 'ai', label: 'AI 助手' },
  ] },
  { group: '业务数据', items: [
    { icon: 'leads', label: '销售线索' },
    { icon: 'customers', label: '客户', active: true },
    { icon: 'deals', label: '跟单商机' },
    { icon: 'activities', label: '跟进活动' },
    { icon: 'contracts', label: '合同' },
    { icon: 'payments', label: '回款' },
  ] },
  { group: '管理', items: [
    { icon: 'members', label: '成员管理' },
    { icon: 'audit', label: '公司审计' },
    { icon: 'settings', label: '设置' },
  ] },
];

export const tabs = [
  { label: '全部客户', count: '16', active: true },
  { label: '我负责的', count: '4' },
  { label: '公共池', count: '3' },
];

// 业务编号 is the record's own number; grade is the 客户等级 single-select.
export const customers = [
  { no: 1, name: '澜庭智能科技（杭州）', grade: 'A', industry: '企业服务', owner: '赵晨', phone: '138 1742 0396', updated: '今天 10:20' },
  { no: 13, name: '鹿鸣生物科技', grade: 'C', industry: '医疗健康', owner: '孙悦', phone: '150 9185 3402', updated: '今天 09:05' },
  { no: 2, name: '江南纸业集团', grade: 'B', industry: '制造业', owner: '孙悦', phone: '139 2210 4417', updated: '昨天 16:12' },
  { no: 7, name: '北辰物流', grade: 'B', industry: '物流', owner: '周岚', phone: '177 3419 5582', updated: '10月19日' },
  { no: 11, name: '衡远能源设备', grade: 'C', industry: '制造业', owner: '王宁', phone: '182 7716 0035', updated: '10月19日' },
  { no: 3, name: '启明教育科技', grade: 'A', industry: '教育', owner: '钱宇', phone: '137 5538 9026', updated: '10月18日' },
  { no: 4, name: '海岸线跨境电商', grade: 'A', industry: '零售', owner: '郑凯', phone: '186 0071 3358', updated: '10月17日' },
  { no: 8, name: '拾光家居', grade: 'B', industry: '零售', owner: '李昂', phone: '188 1063 7794', updated: '10月16日' },
  { no: 5, name: '远山医疗器械', grade: 'A', industry: '医疗健康', owner: '钱宇', phone: '135 8820 6149', updated: '10月15日' },
  { no: 12, name: '听潮餐饮管理', grade: 'B', industry: '餐饮', owner: '周岚', phone: '133 6240 8873', updated: '10月14日' },
  { no: 6, name: '青禾农业发展', grade: 'C', industry: '农业', owner: '王宁', phone: '159 0366 2701', updated: '10月12日' },
  { no: 9, name: '星河文旅', grade: 'C', industry: '文旅', owner: '吴桐', phone: '136 0457 1238', updated: '10月11日' },
  { no: 10, name: '锦程会计师事务所', grade: 'B', industry: '专业服务', owner: '周岚', phone: '155 2984 6610', updated: '10月9日' },
  { no: 14, name: '万象城市更新', grade: 'C', industry: '地产', owner: '王宁', phone: '189 4472 1596', updated: '9月30日' },
  { no: 15, name: '云舟软件', grade: 'A', industry: '企业服务', owner: '李昂', phone: '131 7058 2264', updated: '9月28日' },
  { no: 16, name: '瀚海建材', grade: 'C', industry: '制造业', owner: '郑凯', phone: '187 3391 0482', updated: '9月26日' },
];

// Already ordered the way a list grouped by 客户等级 shows them (A, then B, then C).
export const gradeLabel = { A: 'A 级', B: 'B 级', C: 'C 级' };

export const record = {
  no: 1,
  name: '澜庭智能科技（杭州）',
  grade: 'A',
  industry: '企业服务',
  owner: '赵晨',
  phone: '138 1742 0396',
  created: '10月9日 09:41',
  updated: '今天 10:20',
  note: '对接人周明远，年度续约预算约 40 万，10 月底前需要看到报价方案。',
  followUps: [
    { title: '确认报价单并约下次拜访', owner: '赵晨', due: '10月18日 16:00', state: 'overdue', dueLabel: '已逾期' },
    { title: '发送续约方案', owner: '赵晨', due: '明天 10:00', state: 'open', dueLabel: '明天' },
  ],
  activity: [
    { who: '赵晨', text: '追加了活动「电话沟通：确认预算范围」', at: '今天 10:20' },
    { who: '赵晨', text: '把客户等级由 B 级改为 A 级', at: '昨天 16:12' },
    { who: '陈静', text: '创建了这条记录', at: '10月9日' },
  ],
  related: [{ kind: '跟单商机', name: '数字化改造项目', meta: '¥92,000 · 方案报价' }],
};

export const objectConfig = {
  name: '客户',
  code: 'customers',
  version: 'v3',
  pending: 3,
  fields: [
    { name: '客户名称', key: 'customer_name', type: '单行文本', typeIcon: 'textSingle', required: true, title: true, access: '可编辑', status: '已发布' },
    { name: '联系电话', key: 'phone', type: '电话', typeIcon: 'phone', required: true, access: '可编辑', status: '已发布', changed: true },
    { name: '客户等级', key: 'grade', type: '单选', typeIcon: 'select', required: false, access: '可编辑', status: '已发布' },
    { name: '所属行业', key: 'industry', type: '单选', typeIcon: 'select', required: false, access: '可编辑', status: '已发布' },
    { name: '客户备注', key: 'note', type: '多行文本', typeIcon: 'textMulti', required: false, access: '可编辑', status: '已发布' },
    { name: '年度预算（万元）', key: 'annual_budget', type: '数字', typeIcon: 'number', required: false, access: '仅查看', status: '未发布', changed: true, selected: true },
    { name: '下次拜访日期', key: 'next_visit', type: '日期', typeIcon: 'calendar', required: false, access: '可编辑', status: '未发布', changed: true },
    { name: '旧联系方式', key: 'legacy_contact', type: '单行文本', typeIcon: 'textSingle', required: false, access: '不可见', status: '已停用' },
  ],
  changes: [
    { kind: '新增字段', text: '年度预算（万元）' },
    { kind: '新增字段', text: '下次拜访日期' },
    { kind: '员工访问', text: '联系电话：仅查看 → 可编辑' },
  ],
  editor: {
    name: '年度预算（万元）',
    key: 'annual_budget',
    type: '数字',
    min: '0',
    decimals: '2',
    hint: '填写客户本年度计划投入的预算，单位万元。',
  },
};
