// Direction A · 安静工作台（Linear / Attio）
// Neutral zinc surfaces, one teal accent taken from the logo, hairline structure,
// AI docked as a non-modal right rail that shares the record's context.
import { icon as i, esc, page, tenant, me, nav, record, ai, security } from "./shared.mjs";

const css = `
:root{--bg:#fff;--side:#f7f7f8;--line:#e7e7ea;--hair:#f0f0f2;--t1:#18181b;--t2:#52525b;--t3:#71717a;--acc:#0f766e;--acc-h:#115e59;--acc-soft:#e8f3f1;--amber:#b45309;--amber-soft:#fdf4e7;--hover:#f1f1f3}
body{font:13px/1.5 Inter,"PingFang SC","Noto Sans SC",sans-serif;color:var(--t1);background:var(--bg);width:1440px;height:900px;overflow:hidden;font-feature-settings:"tnum" 1}
.app{display:grid;grid-template-columns:232px 1fr;height:900px}
.side{background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:10px 8px}
.ws{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px}
.ws .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#14b8a6,#0f766e);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:600}
.ws b{font-weight:600;font-size:13px;flex:1}
.ws .ic{color:var(--t3)}
.search{margin:8px 0 6px;display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--t3)}
.search kbd{margin-left:auto;font:11px Inter;color:var(--t3);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.grp{margin-top:14px}
.grp h6{font-size:11.5px;font-weight:500;color:var(--t3);padding:0 8px 4px;letter-spacing:.02em}
.item{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:6px;color:var(--t2)}
.item .ic{color:var(--t3)}
.item.on{background:#ebebee;color:var(--t1);font-weight:500}
.item.on .ic{color:var(--t1)}
.item em{margin-left:auto;font-style:normal;font-size:12px;color:var(--t3)}
.me{margin-top:auto;display:flex;align-items:center;gap:8px;padding:8px;border-top:1px solid var(--line)}
.av{width:26px;height:26px;border-radius:50%;background:#dbeafe;color:#1e3a8a;display:grid;place-items:center;font-size:12px;font-weight:600}
.me small{display:block;color:var(--t3);font-size:11.5px;line-height:1.2}
.main{display:grid;grid-template-columns:1fr 392px;min-width:0}
.top{height:48px;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid var(--line)}
.crumb{display:flex;align-items:center;gap:6px;color:var(--t3)}
.crumb b{color:var(--t1);font-weight:500}
.spacer{flex:1}
.btn{height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--t1);font-size:13px}
.btn.ghost{border-color:transparent;color:var(--t2)}
.btn.on{background:var(--acc-soft);border-color:#c5e3dd;color:var(--acc)}
.btn.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:500}
.iconbtn{width:28px;height:28px;display:grid;place-items:center;border-radius:6px;color:var(--t3)}
.rec{overflow:hidden}
.head{padding:22px 28px 16px;border-bottom:1px solid var(--hair)}
.head .kicker{display:flex;align-items:center;gap:6px;color:var(--t3);font-size:12px}
.head h1{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:6px 0 8px}
.chips{display:flex;gap:8px;align-items:center;color:var(--t2)}
.chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:#fff}
.dot{width:7px;height:7px;border-radius:50%;background:#2563eb}
.body{display:grid;grid-template-columns:272px 1fr;height:calc(900px - 48px - 107px)}
.props{border-right:1px solid var(--hair);padding:14px 16px 0 28px}
.props h3,.feed h3{font-size:12px;font-weight:500;color:var(--t3);margin-bottom:6px}
.prow{display:grid;grid-template-columns:84px 1fr;gap:8px;padding:6px 0;align-items:center}
.prow span{color:var(--t3)}
.prow b{font-weight:450;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.next{margin-top:14px;padding:10px 12px;border:1px solid var(--line);border-radius:8px}
.next small{color:var(--t3);display:block}
.next b{font-weight:500}
.feed{padding:12px 28px}
.tabs{display:flex;gap:18px;border-bottom:1px solid var(--hair);margin-bottom:14px}
.tabs span{padding:8px 0;color:var(--t3)}
.tabs span.on{color:var(--t1);font-weight:500;box-shadow:inset 0 -2px var(--t1)}
.tabs em{font-style:normal;color:var(--t3);margin-left:4px}
.compose{display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid var(--line);border-radius:8px;color:var(--t3);margin-bottom:16px}
.compose .btn{margin-left:auto}
.ev{display:grid;grid-template-columns:28px 1fr;gap:10px;padding-bottom:16px;position:relative}
.ev:not(:last-child)::before{content:"";position:absolute;left:13px;top:28px;bottom:2px;width:1px;background:var(--hair)}
.ev .mk{width:28px;height:28px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;color:var(--t2);background:#fff}
.ev .meta{color:var(--t3);font-size:12px;margin-bottom:2px}
.ev .meta b{color:var(--t1);font-weight:500;margin-right:6px}
.ev p{color:var(--t1);line-height:1.6}
/* AI rail */
.rail{border-left:1px solid var(--line);display:flex;flex-direction:column;background:#fcfcfd}
.rail .rh{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px 0 16px;border-bottom:1px solid var(--line)}
.rail .rh b{font-weight:600}
.spark{color:var(--acc)}
.ctx{margin:12px 16px 0;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);background:#fff;border:1px solid var(--line);border-radius:6px;padding:4px 8px;width:max-content}
.msgs{flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
.u{align-self:flex-end;max-width:300px;background:#f1f1f3;border-radius:10px;padding:8px 11px;color:var(--t1)}
.a{display:flex;flex-direction:column;gap:8px}
.a .who{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3)}
.a .who b{color:var(--t1);font-weight:500}
.prop{border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}
.prop .ph{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--hair)}
.badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:5px;font-size:12px;font-weight:500}
.badge.wait{background:var(--amber-soft);color:var(--amber)}
.badge.ok{background:var(--acc-soft);color:var(--acc)}
.chg{display:grid;grid-template-columns:72px 1fr;gap:8px;padding:8px 12px;border-bottom:1px solid var(--hair)}
.chg span{color:var(--t3)}
.chg s{color:var(--t3);text-decoration-color:#a1a1aa}
.chg .to{color:var(--t1);font-weight:500}
.evid{padding:8px 12px;color:var(--t2);font-size:12px;background:#fafafa;border-bottom:1px solid var(--hair)}
.acts{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px}
.trace{display:flex;align-items:center;gap:6px;color:var(--t3);font-size:12px}
.composer{margin:0 12px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px}
.qk{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.qk span{height:24px;display:inline-flex;align-items:center;padding:0 8px;border-radius:6px;background:var(--hover);color:var(--t2);font-size:12px}
.inp{display:flex;align-items:center;gap:8px;color:var(--t3);height:30px;padding-left:4px}
.inp .send{margin-left:auto;width:28px;height:28px;border-radius:6px;background:var(--acc);color:#fff;display:grid;place-items:center}
/* settings */
.set{display:grid;grid-template-columns:232px 1fr;height:900px}
.back{display:flex;align-items:center;gap:6px;color:var(--t2);padding:6px 8px;margin-bottom:6px}
.content{overflow:hidden;display:flex;justify-content:center}
.col{width:680px;padding:48px 0}
.col h1{font-size:22px;font-weight:600;margin-bottom:4px}
.col .lead{color:var(--t2);margin-bottom:28px}
.sec{margin-bottom:28px}
.sec .sh{display:flex;align-items:flex-end;margin-bottom:10px}
.sec h2{font-size:14px;font-weight:600}
.sec .sh p{color:var(--t3);font-size:12.5px}
.card{border:1px solid var(--line);border-radius:10px;background:#fff}
.row{display:flex;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--hair);min-height:58px}
.row:last-child{border-bottom:0}
.row .l{flex:1}
.row .l b{font-weight:500;display:block}
.row .l small{color:var(--t3);font-size:12.5px}
.row .v{color:var(--t1)}
.tile{width:32px;height:32px;border-radius:8px;background:var(--hover);display:grid;place-items:center;color:var(--t2)}
.sw{width:32px;height:18px;border-radius:9px;background:var(--acc);position:relative}
.sw::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.cur{font-size:11.5px;color:var(--acc);background:var(--acc-soft);border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:500}
.link{color:var(--t2);display:inline-flex;align-items:center;gap:4px}
.danger{color:#b42318}
`;

function sidebar() {
  const item = (n) => `<div class="item${n.active ? " on" : ""}">${i(n.key, 16)}<span>${esc(n.label)}</span>${n.count ? `<em>${n.count}</em>` : ""}</div>`;
  return `<aside class="side">
  <div class="ws"><span class="logo">${tenant.initial}</span><b>${tenant.name}</b>${i("chevron-down", 14)}</div>
  <div class="search">${i("search", 14)}<span>搜索或跳转</span><kbd>⌘K</kbd></div>
  <div class="grp">${nav.work.map(item).join("")}</div>
  <div class="grp"><h6>业务表</h6>${nav.data.map(item).join("")}</div>
  <div class="me"><span class="av">${me.initial}</span><div><b>${me.name}</b><small>${me.role}</small></div><span class="spacer"></span>${i("settings", 15, 1.75, "")}</div>
</aside>`;
}

const recordHtml = page({
  title: "A 安静工作台 · 商机详情与 AI",
  css,
  body: `<div class="app">${sidebar()}
<div class="main">
  <section class="rec">
    <div class="top">
      <div class="crumb">${i("handshake", 15)}<span>${record.object}</span>${i("chevron-right", 14)}<b>${record.title}</b></div>
      <span class="spacer"></span>
      <span class="iconbtn">${i("chevron-left", 16)}</span><span class="iconbtn">${i("chevron-right", 16)}</span>
      <span class="btn">${i("notebook-pen", 14)}整理沟通</span>
      <span class="btn">${i("pencil", 14)}编辑</span>
      <span class="btn on">${i("sparkles", 14)}AI</span>
    </div>
    <div class="head">
      <div class="kicker">${record.object} ${record.no} · ${record.updated}</div>
      <h1>${record.title}</h1>
      <div class="chips"><span class="chip"><span class="dot"></span>${record.stage}</span><span class="chip">${i("building-2", 13)}${record.customer}</span><span class="chip">${record.amount}</span><span class="chip"><span class="av" style="width:16px;height:16px;font-size:10px">${me.initial}</span>${record.owner}</span></div>
    </div>
    <div class="body">
      <div class="props">
        <h3>属性</h3>
        ${record.props.map(([k, v]) => `<div class="prow"><span>${k}</span><b>${v}</b></div>`).join("")}
        <div class="next"><small>下次跟进</small><b>${record.nextFollow}</b><div style="color:var(--t2)">${record.nextFollowTitle}</div></div>
      </div>
      <div class="feed">
        <div class="tabs"><span class="on">动态</span><span>跟进<em>1</em></span><span>关联<em>2</em></span><span>附件<em>0</em></span><span>自动化</span></div>
        <div class="compose">${i("square-pen", 15)}<span>记一笔沟通，或粘贴聊天原文交给 AI 整理</span><span class="btn ghost">${i("sparkles", 14)}AI 整理</span></div>
        ${record.timeline.map((e) => `<div class="ev"><span class="mk">${i(e.icon, 14)}</span><div><div class="meta"><b>${e.kind}</b>${e.who} · ${e.time}</div><p>${e.text}</p></div></div>`).join("")}
      </div>
    </div>
  </section>
  <aside class="rail">
    <div class="rh">${i("sparkles", 16, 1.75, "spark")}<b>AI 助手</b><span class="spacer"></span><span class="iconbtn">${i("history", 15)}</span><span class="iconbtn">${i("x", 15)}</span></div>
    <div class="ctx">${i("handshake", 13)}正在查看：${record.title}</div>
    <div class="msgs">
      <div class="u">${ai.ask}</div>
      <div class="a">
        <div class="who">${i("sparkles", 13, 1.75, "spark")}<b>AI</b><span>· ${ai.tools}</span></div>
        <div>${ai.answer}</div>
        <div class="prop">
          <div class="ph"><span class="badge wait">${i("clock", 12)}待确认</span><b style="font-weight:500">${ai.changes.length} 项修改</b><span class="spacer"></span><span style="color:var(--t3);font-size:12px">15 分钟内有效</span></div>
          ${ai.changes.map((c) => `<div class="chg"><span>${c.label}</span><div>${c.from === "—" ? "" : `<s>${c.from}</s> → `}<span class="to">${c.to}</span></div></div>`).join("")}
          <div class="evid">${ai.evidence}</div>
          <div class="acts"><span class="btn">拒绝</span><span class="btn pri">${i("check", 14)}确认执行</span></div>
        </div>
        <div class="trace">${i("circle-check", 13)}只会修改你有权限编辑的字段</div>
      </div>
    </div>
    <div class="composer">
      <div class="qk">${ai.quick.map((q) => `<span>${q}</span>`).join("")}</div>
      <div class="inp"><span>问这个商机的任何事…</span><span class="send">${i("corner-down-left", 14)}</span></div>
    </div>
  </aside>
</div></div>`,
});

const settingsSide = `<aside class="side">
  <div class="back">${i("chevron-left", 15)}返回工作区</div>
  <div class="grp"><h6>账号</h6>
    <div class="item">${i("user-round", 16)}<span>个人资料</span></div>
    <div class="item on">${i("shield-check", 16)}<span>账号安全</span></div>
  </div>
  <div class="grp"><h6>${tenant.name}</h6>
    <div class="item">${i("briefcase-business", 16)}<span>我在公司的资料</span></div>
  </div>
  <div class="me"><span class="av">${me.initial}</span><div><b>${me.name}</b><small>${me.phone}</small></div></div>
</aside>`;

const securityHtml = page({
  title: "A 安静工作台 · 账号安全",
  css,
  body: `<div class="set">${settingsSide}
<main class="content"><div class="col">
  <h1>账号安全</h1>
  <p class="lead">管理登录方式、密码和已登录的设备。</p>
  <div class="sec">
    <div class="sh"><h2>登录与验证</h2></div>
    <div class="card">
      <div class="row"><span class="tile">${i("phone", 16)}</span><div class="l"><b>手机号</b><small>主账号，用于登录和接收验证码</small></div><span class="v">${me.phone}</span></div>
      <div class="row"><span class="tile">${i("mail", 16)}</span><div class="l"><b>邮箱 <span class="cur">已验证</span></b><small>用于找回密码和接收安全提醒</small></div><span class="v">${me.email}</span><span class="btn">更换</span><span class="iconbtn">${i("more-horizontal", 16)}</span></div>
      <div class="row"><span class="tile">${i("key-round", 16)}</span><div class="l"><b>密码</b><small>修改后其他设备会退出登录</small></div><span class="btn">修改密码</span></div>
      <div class="row"><span class="tile">${i("bell", 16)}</span><div class="l"><b>新设备登录提醒</b><small>在不认识的设备上登录时发邮件提醒你</small></div><span class="sw"></span></div>
    </div>
  </div>
  <div class="sec">
    <div class="sh"><div><h2>登录设备</h2><p>不认识的设备请退出，它需要重新登录。</p></div><span class="spacer"></span><span class="btn ghost danger">退出其他所有设备</span></div>
    <div class="card">
      ${security.sessions.map((s) => `<div class="row"><span class="tile">${i(s.icon, 16)}</span><div class="l"><b>${s.device}${s.current ? `<span class="cur">本机</span>` : ""}</b><small>${s.place} · ${s.last}</small></div>${s.current ? "" : `<span class="btn">退出</span>`}</div>`).join("")}
    </div>
    <div style="margin-top:10px"><span class="link">${i("history", 14)}查看最近 90 天登录记录 ${i("arrow-right", 13)}</span></div>
  </div>
</div></main></div>`,
});

export const files = { "a-record.html": recordHtml, "a-security.html": securityHtml };
