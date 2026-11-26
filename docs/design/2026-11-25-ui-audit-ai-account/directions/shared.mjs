// Shared product facts for the three direction mock-ups. Every direction renders
// the same record, the same AI turn and the same account state; only structure
// and styling differ. Names and numbers are demo data, not customer data.
import fs from "node:fs";

const lucide = JSON.parse(fs.readFileSync(new URL("./lucide.json", import.meta.url), "utf8"));

export function icon(name, size = 16, stroke = 1.75, cls = "") {
  const def = lucide.icons[name] ?? lucide.icons[lucide.aliases?.[name]?.parent];
  if (!def) throw new Error(`missing lucide icon ${name}`);
  const body = def.body.replace(/stroke-width="[\d.]+"/g, `stroke-width="${stroke}"`);
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function page({ title, css, body, width = 1440 }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=${width}">
<style>
@font-face{font-family:"Inter";src:url("../../2026-10-20-ui-direction/fonts/inter.woff2") format("woff2");font-weight:100 900;font-display:block}
*{box-sizing:border-box;margin:0;padding:0}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.ic{flex:none;display:inline-block;vertical-align:middle}
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export const tenant = { name: "星云科技演示公司", code: "nebula-demo", initial: "星" };
export const me = { name: "孙悦", role: "销售", initial: "孙", phone: "+86 188****1005", email: "s***@example.test" };

export const nav = {
  work: [
    { key: "house", label: "我的工作台" },
    { key: "inbox", label: "消息", count: 3 },
    { key: "calendar-check", label: "跟进待办", count: 5 },
    { key: "list-checks", label: "任务与日报" },
    { key: "sparkles", label: "AI 助手" },
  ],
  data: [
    { key: "target", label: "销售线索" },
    { key: "building-2", label: "客户" },
    { key: "handshake", label: "跟单商机", active: true },
    { key: "message-square-text", label: "跟进活动" },
    { key: "file-text", label: "合同" },
    { key: "receipt", label: "回款" },
  ],
};

export const record = {
  object: "跟单商机",
  no: "#128",
  title: "华东仓储系统升级",
  customer: "华东仓储（上海）有限公司",
  stage: "方案报价",
  stages: ["需求确认", "方案报价", "商务谈判", "已成交"],
  amount: "¥128,000",
  closeDate: "2026-12-15",
  owner: "孙悦",
  nextFollow: "12月2日 周三 09:00",
  nextFollowTitle: "现场演示",
  lastContact: "今天 15:20 · 电话",
  updated: "今天 15:24 更新",
  props: [
    ["客户", "华东仓储（上海）有限公司"],
    ["联系人", "王建国 · 采购总监"],
    ["商机阶段", "方案报价"],
    ["预计金额", "¥128,000"],
    ["预计成交日", "2026-12-15"],
    ["负责人", "孙悦"],
    ["来源", "官网咨询"],
  ],
  timeline: [
    { kind: "电话", icon: "phone", time: "今天 15:20", who: "孙悦", text: "王总对方案基本认可，预算 9 万已经批了。约定下周三上午来公司做现场演示，演示后可以签合同。" },
    { kind: "微信", icon: "message-square-text", time: "11月18日 10:05", who: "孙悦", text: "发送第二版报价单（含三年维保），客户回复下周内部评审。" },
    { kind: "拜访", icon: "map-pin", time: "11月12日 14:00", who: "孙悦", text: "现场调研三号仓，确认 WMS 需对接现有 ERP，客户关心上线周期。" },
  ],
};

export const ai = {
  ask: "把阶段改成商务谈判，再加一条下周三上午的跟进",
  answer: "已根据今天 15:20 的电话记录准备了 2 项修改，确认后才会写入。",
  changes: [
    { label: "商机阶段", from: "方案报价", to: "商务谈判" },
    { label: "新增跟进", from: "—", to: "12月2日 周三 09:00 · 现场演示" },
  ],
  evidence: "依据：今天 15:20 电话 ·「约定下周三上午来公司做现场演示」",
  quick: ["总结这个商机", "帮我写微信", "整理本次沟通"],
  tools: "查询了 3 项数据 · 2.1 秒",
};

export const security = {
  phone: "+86 188****1003",
  email: "z***@example.test",
  sessions: [
    { device: "Chrome · macOS", icon: "laptop", place: "上海 · 电信", last: "当前会话", current: true },
    { device: "Edge · Windows", icon: "monitor", place: "上海 · 联通", last: "今天 23:52" },
    { device: "微信内置浏览器 · iPhone", icon: "smartphone", place: "苏州 · 移动", last: "11月20日 08:41" },
  ],
};
