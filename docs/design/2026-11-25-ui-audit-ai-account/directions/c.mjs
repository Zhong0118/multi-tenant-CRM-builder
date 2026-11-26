// Direction C · 文档流 · 内联 AI（Notion / Airtable）
// A record reads like a page: serif title, property list, AI summary and suggested
// edits as inline blocks, follow-ups as prose, and a floating command bar.
import { icon as i, esc, page, tenant, me, nav, record, ai, security } from "./shared.mjs";

const css = `
:root{--paper:#fbfaf8;--side:#f6f5f2;--line:#e9e7e2;--hair:#efede9;--t1:#191919;--t2:#5f5e5b;--t3:#7a7975;--hover:#efeeea;--ai:#6e56cf;--ai-soft:#f3f0fd;--ai-line:#e0d9f8;--new:#e7f5ec;--new-t:#1d7a46;--old:#fbecec;--old-t:#b4453c;--yellow:#fbf3db;--yellow-t:#8a6a12}
body{font:14px/1.6 Inter,"PingFang SC","Noto Sans SC",sans-serif;color:var(--t1);background:var(--paper);width:1440px;height:900px;overflow:hidden;font-feature-settings:"tnum" 1}
.serif{font-family:"Songti SC","Noto Serif SC","STSong",serif}
.app{display:grid;grid-template-columns:240px 1fr;height:900px}
.side{background:var(--side);border-right:1px solid var(--line);padding:10px 8px;display:flex;flex-direction:column}
.ws{display:flex;align-items:center;gap:8px;padding:6px 8px}
.ws .lg{width:22px;height:22px;border-radius:5px;background:var(--t1);color:var(--paper);display:grid;place-items:center;font-size:12px;font-weight:600}
.ws b{font-weight:600;font-size:13.5px;flex:1}
.it{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;border-radius:5px;color:var(--t2);font-size:13.5px}
.it .ic{color:var(--t3)}
.it.on{background:var(--hover);color:var(--t1);font-weight:500}
.it.on .ic{color:var(--t1)}
.it.sub{padding-left:30px;font-size:13px}
.it .ai{color:var(--ai)}
.side h6{font-size:12px;font-weight:500;color:var(--t3);padding:16px 8px 4px}
.main{position:relative;overflow:hidden}
.top{height:44px;display:flex;align-items:center;gap:10px;padding:0 14px;color:var(--t2);font-size:13.5px}
.top .cr{display:flex;align-items:center;gap:4px}
.top .cr .ic{color:var(--t3)}
.spacer{flex:1}
.tbtn{height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 8px;border-radius:5px;color:var(--t2)}
.doc{width:720px;margin:0 auto;padding-top:30px}
.pic{width:52px;height:52px;border-radius:12px;background:#efe9df;color:#8a6a3a;display:grid;place-items:center;margin-bottom:12px}
.doc h1{font-size:36px;font-weight:700;line-height:1.25;letter-spacing:.01em;margin-bottom:14px}
.pl{display:grid;grid-template-columns:150px 1fr;row-gap:1px;margin-bottom:12px}
.pl .k{display:flex;align-items:center;gap:8px;height:32px;color:var(--t3);font-size:13.5px}
.pl .v{display:flex;align-items:center;gap:8px;height:32px;padding:0 6px;border-radius:4px}
.pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:13px}
.pill.y{background:var(--yellow);color:var(--yellow-t)}
.u{text-decoration:underline;text-decoration-color:#cfcdc7;text-underline-offset:3px}
.mini{width:20px;height:20px;border-radius:50%;background:#e6e1d8;color:#5f5e5b;display:grid;place-items:center;font-size:11px;font-weight:600}
.hr{height:1px;background:var(--line);margin:14px 0}
.callout{display:flex;gap:10px;background:var(--ai-soft);border-radius:6px;padding:12px 14px;margin-bottom:12px}
.callout .ic{color:var(--ai);margin-top:3px}
.callout p{line-height:1.7}
.callout small{display:block;color:var(--t3);font-size:12px;margin-top:2px}
.sug{border:1px solid var(--ai-line);border-radius:8px;background:#fff;margin-bottom:26px;overflow:hidden}
.sug .h{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--hair);color:var(--t2);font-size:13px}
.sug .h b{color:var(--ai);font-weight:600}
.dl{display:grid;grid-template-columns:120px 1fr;padding:7px 14px;align-items:center}
.dl span{color:var(--t3);font-size:13.5px}
.del{background:var(--old);color:var(--old-t);text-decoration:line-through;padding:1px 5px;border-radius:3px;margin-right:6px}
.add{background:var(--new);color:var(--new-t);padding:1px 5px;border-radius:3px;font-weight:500}
.sug .f{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--hair);background:#fdfcfb}
.b{height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border-radius:5px;border:1px solid var(--line);background:#fff;color:var(--t1);font-size:13px}
.b.k{background:var(--t1);border-color:var(--t1);color:#fff;font-weight:500}
.b.g{border-color:transparent;color:var(--t2);background:none}
.sug .f small{margin-left:auto;color:var(--t3);font-size:12px}
.doc h2{font-size:22px;font-weight:700;display:flex;align-items:center;margin-bottom:8px}
.doc h2 .b{margin-left:auto;font-family:Inter,"PingFang SC",sans-serif;font-weight:400}
.entry{padding:8px 0 10px}
.entry .m{color:var(--t3);font-size:12.5px;display:flex;align-items:center;gap:6px;margin-bottom:2px}
.entry p{line-height:1.75}
.bar{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:600px;height:50px;border-radius:25px;background:#fff;border:1px solid var(--line);box-shadow:0 10px 30px rgba(25,25,25,.10),0 2px 6px rgba(25,25,25,.05);display:flex;align-items:center;gap:10px;padding:0 8px 0 18px;color:var(--t3)}
.bar .ic.ai{color:var(--ai)}
.bar kbd{margin-left:auto;font:12px Inter;border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--t3)}
.bar .go{width:34px;height:34px;border-radius:50%;background:var(--t1);color:#fff;display:grid;place-items:center}
.bar .chip{height:26px;display:inline-flex;align-items:center;padding:0 10px;border-radius:13px;background:var(--side);color:var(--t2);font-size:12.5px}
/* settings modal */
.dim{position:absolute;inset:0;background:rgba(25,25,25,.42);z-index:5}
.modal{position:absolute;left:200px;top:96px;width:1040px;height:708px;background:var(--paper);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.25);z-index:6;display:grid;grid-template-columns:232px 1fr;overflow:hidden}
.mside{background:var(--side);padding:14px 8px;border-right:1px solid var(--line)}
.mside h6{font-size:12px;font-weight:500;color:var(--t3);padding:10px 8px 4px}
.mwho{display:flex;align-items:center;gap:8px;padding:4px 8px 8px}
.mwho .mini{width:24px;height:24px;font-size:12px}
.mwho small{display:block;color:var(--t3);font-size:12px;line-height:1.2}
.mbody{padding:34px 52px;overflow:hidden}
.mbody h1{font-size:20px;font-weight:600;padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:22px}
.mbody h3{font-size:13px;font-weight:500;color:var(--t3);margin-bottom:4px}
.srow{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--hair)}
.srow .l{flex:1}
.srow .l b{font-weight:500;display:flex;align-items:center;gap:8px}
.srow .l small{display:block;color:var(--t3);font-size:12.5px}
.ok{font-size:12px;color:var(--new-t);background:var(--new);border-radius:3px;padding:0 6px;font-weight:500}
.sw{width:34px;height:20px;border-radius:10px;background:var(--t1);position:relative}
.sw::after{content:"";position:absolute;right:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff}
.sec{margin-bottom:26px}
table{width:100%;border-collapse:collapse}
th{font-weight:400;color:var(--t3);font-size:12.5px;text-align:left;padding:6px 0;border-bottom:1px solid var(--line)}
td{padding:10px 0;border-bottom:1px solid var(--hair);font-size:13.5px}
td .ic{color:var(--t3);margin-right:8px}
td.r{text-align:right}
.cur{font-size:12px;color:var(--t2);background:var(--hover);border-radius:3px;padding:0 6px;margin-left:6px}
.red{color:#b4453c;border-color:#efd2cf}
`;

function sidebar() {
  const it = (n) => `<div class="it${n.active ? " on" : ""}">${i(n.key, 16, 1.75, n.key === "sparkles" ? "ai" : "")}<span>${esc(n.label)}</span></div>`;
  return `<aside class="side">
  <div class="ws"><span class="lg">${tenant.initial}</span><b>${tenant.name}</b>${i("chevron-down", 14)}</div>
  <div class="it">${i("search", 16)}<span>搜索</span></div>
  ${nav.work.map(it).join("")}
  <h6>业务表</h6>
  ${nav.data.map((n) => it(n) + (n.active ? `<div class="it sub on" style="background:none;font-weight:400;color:var(--t1)">${i("file-text", 14)}<span>${record.title}</span></div>` : "")).join("")}
  <h6>我的视图</h6>
  <div class="it">${i("filter", 16)}<span>本周要跟进的商机</span></div>
  <div class="it">${i("filter", 16)}<span>华东区客户</span></div>
</aside>`;
}

function recordMain() {
  const pv = {
    客户: `<span class="u">${record.customer}</span>`,
    联系人: `<span class="mini">王</span>王建国 · 采购总监`,
    商机阶段: `<span class="pill y">${record.stage}</span>`,
    负责人: `<span class="mini">${me.initial}</span>${record.owner}`,
  };
  const pi = { 客户: "building-2", 联系人: "user-round", 商机阶段: "circle-dot", 预计金额: "receipt", 预计成交日: "calendar", 负责人: "users", 来源: "globe" };
  return `<main class="main">
  <div class="top"><div class="cr">${i("handshake", 15)}<span>${record.object}</span><span style="color:var(--t3)">/</span><span style="color:var(--t1)">${record.title}</span></div><span class="spacer"></span><span style="color:var(--t3);font-size:12.5px">${record.updated}</span><span class="tbtn">${i("notebook-pen", 15)}整理沟通</span><span class="tbtn">${i("more-horizontal", 16)}</span></div>
  <article class="doc">
    <div class="pic">${i("handshake", 26, 1.6)}</div>
    <h1 class="serif">${record.title}</h1>
    <div class="pl">${record.props.map(([k, v]) => `<div class="k">${i(pi[k], 15)}${k}</div><div class="v">${pv[k] ?? v}</div>`).join("")}</div>
    <div class="callout">${i("sparkles", 16)}<div><p><b>AI 摘要</b>　王总认可方案，客户预算 9 万已批，和当前报价 ¥128,000 还有差距。约定下周三上午到公司现场演示，演示后可以签合同。</p><small>根据 3 条跟进生成 · 刚刚</small></div></div>
    <div class="sug">
      <div class="h">${i("wand-sparkles", 14)}<b>AI 建议修改</b><span>· ${ai.evidence.replace("依据：", "依据 ")}</span></div>
      ${ai.changes.map((c) => `<div class="dl"><span>${c.label}</span><div>${c.from === "—" ? "" : `<span class="del">${c.from}</span>`}<span class="add">${c.to}</span></div></div>`).join("")}
      <div class="f"><span class="b k">${i("check", 14, 2)}接受全部</span><span class="b">逐项查看</span><span class="b g">忽略</span><small>只改你有权限编辑的字段</small></div>
    </div>
    <h2 class="serif">跟进记录<span class="b g">${i("plus", 14)}新增</span></h2>
    ${record.timeline.map((e) => `<div class="entry"><div class="m">${i(e.icon, 13)}${e.kind} · ${e.time} · ${e.who}</div><p>${e.text}</p></div>`).join("")}
  </article>
  <div class="bar">${i("sparkles", 18, 1.75, "ai")}<span>问 AI，或输入 / 使用命令</span><span class="chip">总结这个商机</span><span class="chip">帮我写微信</span><kbd>⌘J</kbd><span class="go">${i("arrow-right", 16, 2)}</span></div>
</main>`;
}

const recordHtml = page({
  title: "C 文档流 · 商机详情与 AI",
  css,
  body: `<div class="app">${sidebar()}${recordMain()}</div>`,
});

const securityHtml = page({
  title: "C 文档流 · 账号安全",
  css,
  body: `<div class="app">${sidebar()}${recordMain()}</div>
<div class="dim"></div>
<div class="modal">
  <aside class="mside">
    <h6>账号</h6>
    <div class="mwho"><span class="mini">${me.initial}</span><div><b style="font-size:13.5px">${me.name}</b><small>${me.phone}</small></div></div>
    <div class="it">${i("user-round", 16)}<span>个人资料</span></div>
    <div class="it on">${i("shield-check", 16)}<span>账号安全</span></div>
    <h6>${tenant.name}</h6>
    <div class="it">${i("briefcase-business", 16)}<span>我在公司的资料</span></div>
  </aside>
  <section class="mbody">
    <h1>账号安全</h1>
    <div class="sec">
      <h3>登录方式</h3>
      <div class="srow"><div class="l"><b>手机号</b><small>主账号，用于登录和接收验证码</small></div><span>${me.phone}</span></div>
      <div class="srow"><div class="l"><b>邮箱<span class="ok">已验证</span></b><small>${me.email} · 用于找回密码和接收安全提醒</small></div><span class="b">更换邮箱</span></div>
      <div class="srow"><div class="l"><b>密码</b><small>修改后，其他设备需要重新登录</small></div><span class="b">修改密码</span></div>
    </div>
    <div class="sec">
      <h3>提醒</h3>
      <div class="srow"><div class="l"><b>新设备登录提醒</b><small>在不认识的设备上登录时，发邮件提醒你</small></div><span class="sw"></span></div>
    </div>
    <div class="sec">
      <h3 style="display:flex;align-items:center">登录设备<span class="spacer"></span><span class="b red">退出其他所有设备</span></h3>
      <table>
        <tr><th>设备</th><th>位置</th><th>最近活动</th><th></th></tr>
        ${security.sessions.map((s) => `<tr><td>${i(s.icon, 15)}${s.device}${s.current ? `<span class="cur">本机</span>` : ""}</td><td>${s.place}</td><td>${s.last}</td><td class="r">${s.current ? "" : `<span class="b g">退出</span>`}</td></tr>`).join("")}
      </table>
    </div>
  </section>
</div>`,
});

export const files = { "c-record.html": recordHtml, "c-security.html": securityHtml };
