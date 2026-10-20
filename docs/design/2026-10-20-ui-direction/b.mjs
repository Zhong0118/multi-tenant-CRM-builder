// Direction B — "分组清单" (Linear-leaning). A grouped list instead of a table, a two-pane record,
// and a master-detail field editor. Indigo accent, Tabler line icons.
import { icon, esc, page } from './icons.mjs';
import { company, me, nav, tabs, customers, record, objectConfig, OWNER_HUE } from './data.mjs';

const I = (k, s = 16, c = '') => icon('tabler', k, s, c);
const hue = (name) => OWNER_HUE[name] ?? 200;
const av = (name, size = 22) => `<span class="av" style="--h:${hue(name)};--s:${size}px">${esc(name.slice(-1))}</span>`;
// Grade drawn as a quantity: three bars, filled from the left.
const bars = (g) => {
  const n = { A: 3, B: 2, C: 1 }[g];
  return `<svg class="bars g${g}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${[0, 1, 2]
    .map((i) => `<rect x="${2 + i * 5}" y="${10 - i * 3}" width="3" height="${4 + i * 3}" rx="1" class="${i < n ? 'on' : ''}"/>`)
    .join('')}</svg>`;
};

function sidebar(active = '客户') {
  const [work, ...rest] = nav;
  const item = (i) => `<a class="item${i.label === active ? ' on' : ''}">${I(i.icon, 17)}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</a>`;
  return `
  <aside class="side">
    <div class="top"><a class="ws"><span class="ws-mark">${company.mark}</span><b>${esc(company.name)}</b>${I('chevDown', 14, 'mute')}</a><a class="ib">${I('search', 17)}</a><a class="ib">${I('edit', 17)}</a></div>
    <nav>
      ${work.items.map(item).join('')}
      ${rest.map((g) => `<div class="grp">${esc(g.group)}${I('chevDown', 13)}</div>${g.items.map(item).join('')}`).join('')}
    </nav>
    <div class="me">${av(me.name, 24)}<span>${esc(me.name)}</span>${I('bell', 17, 'mute push')}</div>
  </aside>`;
}

function group(g) {
  const rows = customers.filter((c) => c.grade === g);
  return `
    <section class="grp-block">
      <header class="gh">${I('chevDown', 14, 'mute')}${bars(g)}<b>${g} 级</b><span class="cnt">${rows.length}</span><a class="ib sm">${I('plus', 15)}</a></header>
      ${rows
        .map(
          (c) => `
      <div class="row${c.no === 1 ? ' sel' : ''}">
        <i class="slot"></i>
        <span class="id">#${c.no}</span>
        <span class="title">${esc(c.name)}</span>
        <span class="tag">${I('tag', 13)}${esc(c.industry)}</span>
        <span class="tel">${esc(c.phone)}</span>
        <span class="when">${esc(c.updated)}</span>
        ${av(c.owner, 22)}
      </div>`
        )
        .join('')}
    </section>`;
}

function listBody() {
  return `
    <header class="bar">
      <h1>${I('customers', 17, 'mute')}客户</h1>
      <div class="seg">${tabs.map((t) => `<a class="${t.active ? 'on' : ''}">${esc(t.label)}<span>${t.count}</span></a>`).join('')}</div>
      <div class="sp">
        <a class="btn ghost">${I('search', 16)}搜索</a>
        <a class="btn">${I('filter', 16)}筛选</a>
        <a class="btn">${I('columns', 16)}显示</a>
        <a class="ib">${I('more', 18)}</a>
        <a class="btn primary">${I('plus', 16)}新建客户<kbd>C</kbd></a>
      </div>
    </header>
    <div class="hint">按 <b>客户等级</b> 分组 <i>·</i> 按 <b>最近更新</b> 排序 <i>·</i> 共 16 条</div>
    <div class="list">${['A', 'B', 'C'].map(group).join('')}</div>`;
}

function peek() {
  const r = record;
  const fu = r.followUps
    .map(
      (f) => `
      <li class="${f.state}">
        ${f.state === 'overdue' ? I('warn', 17) : I('circle', 17)}
        <span class="t">${esc(f.title)}</span>
        <span class="due">${esc(f.state === 'overdue' ? `已逾期 · ${f.due}` : f.due)}</span>
        ${av(f.owner, 20)}
      </li>`
    )
    .join('');
  const act = r.activity
    .map((a) => `<li>${av(a.who, 20)}<p><b>${esc(a.who)}</b> ${esc(a.text)}</p><time>${esc(a.at)}</time></li>`)
    .join('');
  return `
  <aside class="peek">
    <div class="pbar">
      <span class="crumb">客户 ${I('chevRight', 13)} <b>#${r.no}</b></span>
      <div class="sp"><span class="pos">1 / 16</span><a class="ib">${I('up', 16)}</a><a class="ib">${I('down', 16)}</a><a class="ib">${I('more', 18)}</a><a class="ib">${I('close', 17)}</a></div>
    </div>
    <div class="pcols">
      <div class="pmain">
        <h2>${esc(r.name)}</h2>
        <p class="desc">${esc(r.note)}</p>
        <div class="sh"><h3>下一步跟进</h3><a class="ib sm">${I('plus', 15)}</a></div>
        <ul class="fus">${fu}</ul>
        <div class="sh"><h3>活动</h3></div>
        <ul class="acts">${act}</ul>
        <div class="compose"><span>追加活动记录…</span>${I('arrowRight', 16)}</div>
      </div>
      <div class="pside">
        <h4>属性</h4>
        <dl>
          <div><dt>等级</dt><dd>${bars(r.grade)}${r.grade} 级</dd></div>
          <div><dt>行业</dt><dd>${esc(r.industry)}</dd></div>
          <div><dt>负责人</dt><dd>${av(r.owner, 20)}${esc(r.owner)}</dd></div>
          <div><dt>电话</dt><dd class="tel">${esc(r.phone)}</dd></div>
          <div><dt>创建</dt><dd>${esc(r.created)}</dd></div>
          <div><dt>更新</dt><dd>${esc(r.updated)}</dd></div>
        </dl>
        <h4>关联</h4>
        <a class="rel">${I('deals', 16)}<span><b>${esc(r.related[0].name)}</b>${esc(r.related[0].meta)}</span></a>
        <div class="foot-actions"><a class="btn">${I('edit', 15)}编辑</a><a class="btn danger">${I('trash', 15)}删除</a></div>
      </div>
    </div>
  </aside>`;
}

export function list() {
  return page({ title: '客户列表 · B', css: 'b.css', body: `<div class="app">${sidebar()}<main class="main">${listBody()}</main></div>` });
}

export function drawer() {
  return page({ title: '客户详情 · B', css: 'b.css', body: `<div class="app">${sidebar()}<main class="main">${listBody()}${peek()}</main></div>` });
}

export function config() {
  const c = objectConfig;
  const e = c.editor;
  const rows = c.fields
    .map(
      (f) => `
      <div class="frow${f.selected ? ' sel' : ''}${f.status === '已停用' ? ' off' : ''}">
        ${I('grip', 16, 'grip')}
        <span class="tbox">${I(f.typeIcon, 15)}</span>
        <span class="fn"><b>${esc(f.name)}</b><code>${esc(f.key)}</code></span>
        ${f.required ? '<span class="pill req">必填</span>' : ''}
        ${f.status === '未发布' ? '<span class="pill new">待发布</span>' : f.status === '已停用' ? '<span class="pill">已停用</span>' : ''}
      </div>`
    )
    .join('');
  const seg = (opts, on) => `<div class="segc">${opts.map((o) => `<a class="${o === on ? 'on' : ''}">${o}</a>`).join('')}</div>`;
  const body = `
  <div class="app">${sidebar('设置')}
    <main class="main">
      <header class="bar">
        <span class="crumb big">设置 ${I('chevRight', 13)} 业务表 ${I('chevRight', 13)} <b>${esc(c.name)}</b></span>
        <span class="ver">${c.version}</span>
        <div class="sp">
          <a class="btn ghost">${I('eye', 16)}员工端预览</a>
          <a class="btn primary">${I('rocket', 16)}发布 ${c.pending} 项变更</a>
        </div>
      </header>
      <div class="ctabs"><a class="on">字段<span>8</span></a><a>列表视图</a><a>员工权限</a><a>流程</a><a>发布记录</a><a>基本设置</a><span class="pending"><i></i>${c.pending} 项修改尚未发布，员工仍在使用 ${c.version}</span></div>
      <div class="cfg">
        <div class="lpane">
          <div class="lh"><span>字段 · 拖动调整顺序</span><a class="btn ghost sm">${I('plus', 15)}新建字段</a></div>
          ${rows}
        </div>
        <div class="rpane">
          <div class="rh"><span class="tbox big">${I('number', 18)}</span><div><small>编辑字段</small><h2>${esc(e.name)}</h2></div></div>
          <div class="form">
            <label>字段名称<div class="inp">${esc(e.name)}</div></label>
            <label>字段键<div class="inp lock"><code>${e.key}</code>${I('lock', 15)}</div><em>发布后不再变更，系统用它稳定识别字段。</em></label>
            <label>数据类型<div class="inp lock">${esc(e.type)}${I('lock', 15)}</div><em>字段发布后不能更改数据类型。</em></label>
            <label>录入要求${seg(['可以留空', '必须填写'], '可以留空')}</label>
            <label>员工访问${seg(['不可见', '仅查看', '可编辑'], '仅查看')}</label>
            <div class="two">
              <label>最小值<div class="inp">${e.min}</div></label>
              <label>小数位<div class="inp">${e.decimals}</div></label>
            </div>
            <label>辅助说明<div class="inp area">${esc(e.hint)}</div></label>
          </div>
          <div class="rfoot"><a class="btn dangerghost">停用字段</a><span class="note">保存后仍需发布，员工才会看到。</span><a class="btn primary">保存字段</a></div>
        </div>
      </div>
    </main>
  </div>`;
  return page({ title: '字段配置 · B', css: 'b.css', body });
}
