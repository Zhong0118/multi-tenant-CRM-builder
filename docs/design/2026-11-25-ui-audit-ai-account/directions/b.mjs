// Direction B · 清爽卡片 · 中文企业（飞书 / 纷享销客 / HubSpot）
// Grey canvas with white cards, a Salesforce-style stage path and stat tiles on the
// record header, colour-tiled navigation, and AI as a floating assistant panel.
import { icon as i, esc, page, tenant, me, nav, record, ai, security } from "./shared.mjs";

const css = `
:root{--canvas:#f2f3f5;--card:#fff;--line:#dee0e3;--hair:#eff0f1;--t1:#1f2329;--t2:#646a73;--t3:#737982;--pri:#3370ff;--pri-h:#245bdb;--pri-soft:#e1eaff;--pri-bg:#f0f4ff;--green:#24801b;--green-soft:#e4f5e1;--orange:#b25f00;--orange-soft:#fef1e1;--red:#f54a45;--violet:#7f3bf5}
body{font:14px/1.55 "PingFang SC","Noto Sans SC",Inter,sans-serif;color:var(--t1);background:var(--canvas);width:1440px;height:900px;overflow:hidden}
.num{font-family:Inter,"PingFang SC",sans-serif;font-feature-settings:"tnum" 1}
.topbar{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;padding:0 20px 0 16px;position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:8px;width:192px}
.brand .lg{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#4e83fd,#3370ff);color:#fff;display:grid;place-items:center;font-weight:600;font-size:14px}
.brand b{font-size:15px;font-weight:600}
.tenant{display:flex;align-items:center;gap:6px;color:var(--t2);padding:4px 8px;border-radius:6px;background:var(--canvas);font-size:13px}
.gsearch{margin-left:24px;width:380px;height:34px;border-radius:8px;background:var(--canvas);display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--t3)}
.spacer{flex:1}
.aibtn{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:16px;background:linear-gradient(90deg,#3370ff,#7f3bf5);color:#fff;font-size:13px;font-weight:500}
.tb-ic{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:var(--t2);position:relative}
.tb-ic i{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--red);border:1.5px solid #fff}
.av{width:30px;height:30px;border-radius:50%;background:#3370ff;color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600;flex:none}
.shell{display:grid;grid-template-columns:208px 1fr;height:844px}
.side{background:#fff;border-right:1px solid var(--line);padding:12px 10px}
.side h6{font-size:12px;font-weight:400;color:var(--t3);padding:14px 10px 6px}
.nv{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border-radius:8px;color:var(--t1)}
.nv .tl{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;color:#fff;flex:none}
.nv.on{background:var(--pri-bg);color:var(--pri);font-weight:500}
.nv em{margin-left:auto;font-style:normal;font-size:12px;min-width:20px;height:18px;border-radius:9px;background:var(--red);color:#fff;display:grid;place-items:center;padding:0 6px}
.canvas{padding:16px;overflow:hidden;position:relative}
.card{background:var(--card);border-radius:12px;box-shadow:0 1px 2px rgba(31,35,41,.06),0 0 0 1px rgba(31,35,41,.04)}
.btn{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--t1);font-size:14px;white-space:nowrap}
.btn.pri{background:var(--pri);border-color:var(--pri);color:#fff;font-weight:500}
.btn.ic{width:32px;padding:0;justify-content:center}
.tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap}
.tag.blue{background:var(--pri-soft);color:var(--pri)}
.tag.green{background:var(--green-soft);color:var(--green)}
.tag.orange{background:var(--orange-soft);color:var(--orange)}
.tag.grey{background:var(--canvas);color:var(--t2)}
/* record header */
.rh{padding:16px 20px}
.r1{display:flex;align-items:center;gap:12px}
.otile{width:44px;height:44px;border-radius:12px;background:#00b3a1;color:#fff;display:grid;place-items:center}
.r1 small{display:block;color:var(--t3);font-size:12px}
.r1 h1{font-size:20px;font-weight:600;line-height:1.3}
.r1 .acts{margin-left:auto;display:flex;gap:8px}
.path{display:flex;margin:14px 0;gap:4px}
.st{flex:1;height:32px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:13px;color:var(--t2);background:var(--canvas);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%,12px 50%)}
.st:first-child{clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%);border-radius:8px 0 0 8px}
.st:last-child{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,12px 50%);border-radius:0 8px 8px 0}
.st.done{background:var(--pri-soft);color:var(--pri)}
.st.cur{background:var(--pri);color:#fff;font-weight:500}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.stat{background:#f7f8fa;border-radius:8px;padding:8px 14px}
.stat small{display:block;color:var(--t3);font-size:12px}
.stat b{font-size:16px;font-weight:600}
.stat span{font-size:12px;color:var(--t2);margin-left:6px;font-weight:400}
/* lower cards */
.cols{display:grid;grid-template-columns:300px 1fr 300px;gap:12px;margin-top:12px;height:576px}
.ch{display:flex;align-items:center;gap:8px;padding:14px 16px 10px}
.ch h3{font-size:15px;font-weight:600}
.ch .more{margin-left:auto;color:var(--t3);font-size:13px;display:flex;align-items:center;gap:2px}
.kv{display:grid;grid-template-columns:84px 1fr;gap:4px 10px;padding:0 16px 14px}
.kv span{color:var(--t3);padding:7px 0}
.kv b{font-weight:400;font-family:Inter,"PingFang SC",sans-serif;padding:7px 0;border-bottom:1px solid var(--hair);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kv a{color:var(--pri);text-decoration:none}
.ftabs{display:flex;gap:6px;padding:0 16px 12px}
.ftabs span{height:28px;display:inline-flex;align-items:center;padding:0 12px;border-radius:14px;background:var(--canvas);color:var(--t2);font-size:13px}
.ftabs span.on{background:var(--pri-soft);color:var(--pri);font-weight:500}
.write{margin:0 16px 14px;height:40px;border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;color:var(--t3)}
.write .btn{margin-left:auto;height:28px;padding:0 10px;font-size:13px;color:var(--violet);border-color:#e3d6fd;background:#f6f1fe}
.tl-it{display:grid;grid-template-columns:36px 1fr;gap:10px;padding:0 16px 16px;position:relative}
.tl-it .mk{width:36px;height:36px;border-radius:50%;display:grid;place-items:center}
.tl-it .hd{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t3);margin-bottom:4px}
.tl-it .hd b{color:var(--t1);font-weight:500}
.tl-it p{background:#f7f8fa;border-radius:8px;padding:10px 12px;line-height:1.65}
.ct{display:flex;align-items:center;gap:10px;padding:10px 16px}
.ct .av{width:36px;height:36px;background:#ff8800}
.ct small{display:block;color:var(--t3);font-size:12px}
.rel{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--hair)}
/* floating assistant */
.fa{position:absolute;right:20px;top:222px;width:372px;height:606px;border-radius:14px;background:#f7f8fa;box-shadow:0 12px 32px rgba(31,35,41,.16),0 0 0 1px rgba(31,35,41,.06);display:flex;flex-direction:column;overflow:hidden;z-index:3}
.fa-h{height:64px;background:linear-gradient(120deg,#3370ff 0%,#5b5cf6 60%,#7f3bf5 100%);color:#fff;display:flex;align-items:center;gap:10px;padding:0 10px 0 16px}
.orb{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.95);display:grid;place-items:center;color:#5b5cf6}
.fa-h b{font-size:15px;font-weight:600;display:block;line-height:1.3}
.fa-h small{font-size:12px;opacity:.85}
.fa-h .x{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;color:#fff}
.fa-b{flex:1;padding:12px 14px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.ub{align-self:flex-end;max-width:270px;background:var(--pri);color:#fff;border-radius:12px 12px 2px 12px;padding:9px 12px}
.am{font-size:12px;color:var(--t3);display:flex;align-items:center;gap:6px}
.ab{background:#fff;border-radius:2px 12px 12px 12px;padding:9px 12px;box-shadow:0 0 0 1px var(--hair)}
.pc{background:#fff;border-radius:10px;border:1px solid var(--line);border-left:3px solid var(--pri);padding:12px}
.pc .t{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.pc .t b{font-weight:600}
.pr{display:grid;grid-template-columns:64px 1fr;gap:8px;padding:6px 0;border-top:1px dashed var(--hair);font-size:13.5px}
.pr span{color:var(--t3)}
.pr s{color:var(--t3)}
.pr .to{font-weight:600}
.pev{margin-top:8px;background:#f7f8fa;border-radius:6px;padding:7px 10px;font-size:12px;color:var(--t2);display:flex;gap:6px}
.big{margin-top:12px;height:38px;border-radius:8px;background:var(--pri);color:#fff;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px}
.nope{margin-top:6px;text-align:center;color:var(--t2);font-size:13px}
.fa-c{padding:10px 14px 14px;background:#fff;border-top:1px solid var(--hair)}
.fa-c .chips{display:flex;gap:6px;margin-bottom:8px}
.fa-c .chips span{height:26px;display:inline-flex;align-items:center;padding:0 10px;border-radius:13px;border:1px solid #c8d7ff;color:var(--pri);font-size:12.5px;background:var(--pri-bg)}
.fa-c .in{height:40px;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;padding:0 6px 0 12px;color:var(--t3)}
.fa-c .send{margin-left:auto;width:30px;height:30px;border-radius:8px;background:var(--pri);color:#fff;display:grid;place-items:center}
/* account centre */
.acc{display:grid;grid-template-columns:220px 1fr;height:844px}
.who{display:flex;align-items:center;gap:10px;padding:8px 10px 16px;border-bottom:1px solid var(--hair);margin-bottom:8px}
.who .av{width:44px;height:44px;font-size:17px}
.who small{display:block;color:var(--t3);font-size:12px}
.wrap{padding:24px 0;display:flex;justify-content:center}
.colm{width:800px;display:flex;flex-direction:column;gap:16px}
.hero{display:flex;align-items:center;gap:18px;padding:22px 24px;background:linear-gradient(100deg,#f0f4ff 0%,#fff 55%)}
.shield{width:56px;height:56px;border-radius:50%;background:var(--pri-soft);color:var(--pri);display:grid;place-items:center}
.hero h2{font-size:18px;font-weight:600}
.hero p{color:var(--t2);font-size:13px}
.checks{margin-left:auto;display:flex;gap:16px}
.checks span{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t1)}
.checks .ic{color:var(--green)}
.grp-h{display:flex;align-items:center;padding:16px 20px 6px}
.grp-h h3{font-size:15px;font-weight:600}
.grp-h .danger{margin-left:auto;color:var(--red);font-size:13px}
.cell{display:flex;align-items:center;gap:14px;min-height:60px;padding:0 20px;border-top:1px solid var(--hair)}
.grp-h + .cell{border-top:0}
.cell .ti{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none}
.cell .l{flex:1}
.cell .l b{font-weight:500;display:flex;align-items:center;gap:8px}
.cell .l small{display:block;color:var(--t3);font-size:12.5px}
.cell .v{color:var(--t2)}
.cell .go{color:var(--t3);display:flex;align-items:center;gap:2px;font-size:13px}
.cell .lnk{color:var(--pri);font-size:13px}
.sw{width:40px;height:22px;border-radius:11px;background:var(--pri);position:relative}
.sw::after{content:"";position:absolute;right:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2)}
`;

const tiles = {
  house: "#3370ff", inbox: "#7f3bf5", "calendar-check": "#ff8800", "list-checks": "#2ea121", sparkles: "linear-gradient(135deg,#3370ff,#7f3bf5)",
  target: "#f54a45", "building-2": "#3370ff", handshake: "#00b3a1", "message-square-text": "#7f3bf5", "file-text": "#ff8800", receipt: "#2ea121",
};

function topbar(right) {
  return `<header class="topbar">
  <div class="brand"><span class="lg">百</span><b>百杰 CRM</b></div>
  <span class="tenant">${i("building-2", 14)}${tenant.name}${i("chevron-down", 14)}</span>
  <div class="gsearch">${i("search", 15)}<span>搜索客户、商机、联系人</span></div>
  <span class="spacer"></span>
  ${right}
</header>`;
}

function sidebar() {
  const nv = (n) => `<div class="nv${n.active ? " on" : ""}"><span class="tl" style="background:${tiles[n.key]}">${i(n.key, 14, 2)}</span><span>${esc(n.label)}</span>${n.count ? `<em class="num">${n.count}</em>` : ""}</div>`;
  return `<aside class="side">${nav.work.map(nv).join("")}<h6>业务数据</h6>${nav.data.map(nv).join("")}</aside>`;
}

const tlColors = { 电话: ["blue", "#e1eaff", "#3370ff"], 微信: ["green", "#e4f5e1", "#2ea121"], 拜访: ["orange", "#fef1e1", "#de7802"] };

const recordHtml = page({
  title: "B 清爽卡片 · 商机详情与 AI",
  css,
  body: `${topbar(`<span class="aibtn">${i("sparkles", 14, 2)}智能助手</span><span class="tb-ic">${i("bell", 18)}<i></i></span><span class="av">${me.initial}</span>`)}
<div class="shell">${sidebar()}
<main class="canvas">
  <section class="card rh">
    <div class="r1">
      <span class="otile">${i("handshake", 22, 2)}</span>
      <div><small>${record.object} · <span class="num">${record.no}</span> · ${record.updated}</small><h1>${record.title}</h1></div>
      <div class="acts"><span class="btn">${i("notebook-pen", 15)}整理沟通</span><span class="btn">${i("pencil", 15)}编辑</span><span class="btn pri">${i("plus", 15, 2)}写跟进</span><span class="btn ic">${i("more-horizontal", 16)}</span></div>
    </div>
    <div class="path">${record.stages.map((s, n) => `<span class="st${n === 0 ? " done" : n === 1 ? " cur" : ""}">${n === 0 ? i("check", 14, 2.25) : ""}${s}</span>`).join("")}</div>
    <div class="stats">
      <div class="stat"><small>预计金额</small><b class="num">${record.amount}</b></div>
      <div class="stat"><small>预计成交日</small><b class="num">${record.closeDate}</b><span>还有 19 天</span></div>
      <div class="stat"><small>客户</small><b style="font-size:15px">华东仓储（上海）</b></div>
      <div class="stat"><small>下次跟进</small><b style="font-size:15px">${record.nextFollow}</b></div>
    </div>
  </section>
  <div class="cols">
    <section class="card">
      <div class="ch"><h3>详细资料</h3><span class="more">编辑</span></div>
      <div class="kv">${record.props.map(([k, v]) => `<span>${k}</span><b>${k === "客户" ? `<a>${v}</a>` : k === "商机阶段" ? `<span class="tag blue">${v}</span>` : v}</b>`).join("")}</div>
    </section>
    <section class="card">
      <div class="ch"><h3>跟进记录</h3><span class="tag grey num">3</span></div>
      <div class="ftabs"><span class="on">全部</span><span>电话</span><span>微信</span><span>拜访</span></div>
      <div class="write">${i("square-pen", 15)}<span>写一条跟进，或粘贴聊天记录</span><span class="btn">${i("sparkles", 13)}AI 整理</span></div>
      ${record.timeline.map((e) => { const [c, bg, fg] = tlColors[e.kind]; return `<div class="tl-it"><span class="mk" style="background:${bg};color:${fg}">${i(e.icon, 16)}</span><div><div class="hd"><span class="tag ${c}">${e.kind}</span><b>${e.who}</b><span class="num">${e.time}</span></div><p>${e.text}</p></div></div>`; }).join("")}
    </section>
    <section class="card">
      <div class="ch"><h3>联系人</h3><span class="more">全部 ${i("chevron-right", 14)}</span></div>
      <div class="ct"><span class="av">王</span><div><b style="font-weight:500">王建国</b><small>采购总监 · 决策人</small></div></div>
      <div class="ch"><h3>关联</h3></div>
      <div class="rel">${i("file-text", 16)}<span>合同</span><span class="spacer"></span><span class="tag grey">0</span></div>
      <div class="rel">${i("paperclip", 16)}<span>附件</span><span class="spacer"></span><span class="tag grey">2</span></div>
    </section>
  </div>
  <aside class="fa">
    <div class="fa-h"><span class="orb">${i("sparkles", 18, 2)}</span><div><b>智能助手</b><small>已读取当前商机和 3 条跟进</small></div><span class="spacer"></span><span class="x">${i("history", 17)}</span><span class="x">${i("x", 18)}</span></div>
    <div class="fa-b">
      <div class="ub">${ai.ask}</div>
      <div class="am">${i("sparkles", 13)}智能助手 · ${ai.tools}</div>
      <div class="ab">${ai.answer}</div>
      <div class="pc">
        <div class="t"><span class="tag orange">${i("clock", 12, 2)}待确认</span><b>${ai.changes.length} 项修改</b></div>
        ${ai.changes.map((c) => `<div class="pr"><span>${c.label}</span><div>${c.from === "—" ? "" : `<s>${c.from}</s> → `}<span class="to">${c.to}</span></div></div>`).join("")}
        <div class="pev">${i("info", 13)}<span>${ai.evidence}</span></div>
        <div class="big">${i("check", 16, 2.25)}确认执行</div>
        <div class="nope">暂不修改</div>
      </div>
    </div>
    <div class="fa-c">
      <div class="chips">${ai.quick.map((q) => `<span>${q}</span>`).join("")}</div>
      <div class="in"><span>输入问题，Enter 发送</span><span class="send">${i("send", 15)}</span></div>
    </div>
  </aside>
</main></div>`,
});

const securityHtml = page({
  title: "B 清爽卡片 · 账号安全",
  css,
  body: `${topbar(`<span class="btn">${i("chevron-left", 15)}返回工作台</span><span class="av">${me.initial}</span>`)}
<div class="acc">
  <aside class="side">
    <div class="who"><span class="av">${me.initial}</span><div><b>${me.name}</b><small class="num">${me.phone}</small></div></div>
    <div class="nv"><span class="tl" style="background:#3370ff">${i("user-round", 14, 2)}</span>个人资料</div>
    <div class="nv on"><span class="tl" style="background:#2ea121">${i("shield-check", 14, 2)}</span>账号安全</div>
    <h6>${tenant.name}</h6>
    <div class="nv"><span class="tl" style="background:#ff8800">${i("briefcase-business", 14, 2)}</span>我在公司的资料</div>
  </aside>
  <main class="wrap"><div class="colm">
    <section class="card hero">
      <span class="shield">${i("shield-check", 28, 1.75)}</span>
      <div><h2>账号安全设置已完成 3/3 项</h2><p>手机号、邮箱和新设备提醒都已就绪，忘记密码时可以用邮箱找回。</p></div>
      <div class="checks"><span>${i("circle-check", 16, 2)}手机号</span><span>${i("circle-check", 16, 2)}邮箱已验证</span><span>${i("circle-check", 16, 2)}新设备提醒</span></div>
    </section>
    <section class="card">
      <div class="grp-h"><h3>登录方式</h3></div>
      <div class="cell"><span class="ti" style="background:#3370ff">${i("phone", 16, 2)}</span><div class="l"><b>手机号</b><small>主账号，用于登录和接收验证码</small></div><span class="v num">${me.phone}</span></div>
      <div class="cell"><span class="ti" style="background:#ff8800">${i("mail", 16, 2)}</span><div class="l"><b>邮箱<span class="tag green">已验证</span></b><small>用于找回密码和接收安全提醒</small></div><span class="v">${me.email}</span><span class="go">更换${i("chevron-right", 15)}</span></div>
      <div class="cell"><span class="ti" style="background:#7f3bf5">${i("key-round", 16, 2)}</span><div class="l"><b>登录密码</b><small>修改后其他设备需要重新登录</small></div><span class="v">已设置</span><span class="go">修改${i("chevron-right", 15)}</span></div>
    </section>
    <section class="card">
      <div class="grp-h"><h3>安全提醒</h3></div>
      <div class="cell"><span class="ti" style="background:#f54a45">${i("bell", 16, 2)}</span><div class="l"><b>新设备登录提醒</b><small>在不认识的设备上登录时，发邮件提醒你</small></div><span class="sw"></span></div>
    </section>
    <section class="card">
      <div class="grp-h"><h3>登录设备</h3><span class="tag grey num" style="margin-left:8px">${security.sessions.length}</span><span class="danger">退出其他设备</span></div>
      ${security.sessions.map((s) => `<div class="cell"><span class="ti" style="background:${s.current ? "#2ea121" : "#8f959e"}">${i(s.icon, 16, 2)}</span><div class="l"><b>${s.device}${s.current ? `<span class="tag green">本机</span>` : ""}</b><small>${s.place} · <span class="num">${s.last}</span></small></div>${s.current ? "" : `<span class="lnk">退出登录</span>`}</div>`).join("")}
    </section>
  </div></main>
</div>`,
});

export const files = { "b-record.html": recordHtml, "b-security.html": securityHtml };
