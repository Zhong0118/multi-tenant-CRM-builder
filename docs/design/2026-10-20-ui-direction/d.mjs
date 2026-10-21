// Direction D = A's palette and page architecture + C's sidebar and segmented tabs.
// (derived from Direction A) — "安静的表" (Attio-leaning). The table is the hero; chrome stays out of its way.
import { icon, esc, page } from './icons.mjs';
import { company, me, nav, tabs, customers, record, objectConfig, OWNER_HUE } from './data.mjs';

const I = (k, s = 18, c = '') => icon('lucide', k, s, c);
const hue = (name) => OWNER_HUE[name] ?? 200;
const av = (name, size = 22) => `<span class="av" style="--h:${hue(name)};--s:${size}px">${esc(name.slice(-1))}</span>`;
const logo = (name, size = 24) => `<span class="logo" style="--h:${(name.charCodeAt(0) * 7) % 360};--s:${size}px">${esc(name[0])}</span>`;
const grade = (g) => `<span class="gr ${g}">${g} 级</span>`;

function sidebar(active = '客户') {
  const groups = nav
    .map((g) => `
    <div class="grp">${esc(g.group)}</div>
    ${g.items
      .map((i) => `<a class="item${i.label === active ? ' on' : ''}">${I(i.icon, 16)}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</a>`)
      .join('')}`)
    .join('');
  return `
  <aside class="side">
    <div class="team"><span class="tile">${company.mark}</span><div><b>${esc(company.name)}</b><span>nebula-demo</span></div>${I('chevUpDown', 16, 'mute push')}</div>
    <nav>${groups}</nav>
    <div class="me">${av(me.name, 32)}<div><b>${esc(me.name)}</b><span>${esc(me.role)}</span></div>${I('chevUpDown', 16, 'mute push')}</div>
  </aside>`;
}

function listBody({ selectedNo } = {}) {
  const rows = customers
    .map(
      (c) => `
      <tr${c.no === selectedNo ? ' class="sel"' : ''}>
        <td class="ck"><i class="box"></i></td>
        <td class="num">${c.no}</td>
        <td><div class="nm">${logo(c.name)}<span>${esc(c.name)}</span></div></td>
        <td class="tab-num">${esc(c.phone)}</td>
        <td>${grade(c.grade)}</td>
        <td>${esc(c.industry)}</td>
        <td><div class="who">${av(c.owner)}<span>${esc(c.owner)}</span></div></td>
        <td class="when">${esc(c.updated)}</td>
      </tr>`
    )
    .join('');
  return `
    <header class="bar">
      <h1>${I('customers', 20, 'acc')}客户</h1>
      <div class="sp">
        <a class="btn ghost">${I('pool', 16)}公共池<span class="n">3</span></a>
        <a class="btn ghost">${I('import', 16)}导入</a>
        <a class="btn ghost">${I('export', 16)}导出</a>
        <a class="btn primary">${I('plus', 16)}新建客户</a>
      </div>
    </header>
    <div class="subbar">
      <div class="seg">${tabs.map((t) => `<a class="${t.active ? 'on' : ''}">${esc(t.label)}<span>${t.count}</span></a>`).join('')}</div>
      <a class="link add">${I('plus', 14)}保存为视图</a>
    </div>
    <div class="tools">
      <div class="find">${I('search', 16)}<span>搜索客户名称、电话、行业</span></div>
      <i class="vr"></i>
      <a class="fchip">${I('user', 16)}负责人${I('chevDown', 12, 'mute')}</a>
      <a class="fchip">${I('tag', 16)}客户等级${I('chevDown', 12, 'mute')}</a>
      <a class="fchip">${I('building', 16)}所属行业${I('chevDown', 12, 'mute')}</a>
      <a class="fchip">${I('clock', 16)}更新时间${I('chevDown', 12, 'mute')}</a>
      <a class="fchip more">${I('filter', 16)}更多筛选</a>
      <div class="sp">
        <a class="fchip">${I('sort', 16)}最近更新${I('down', 13, 'mute')}</a>
        <a class="fchip">${I('columns', 16)}列设置</a>
      </div>
    </div>
    <div class="scroll">
      <table class="grid">
        <thead><tr>
          <th class="ck"><i class="box"></i></th>
          <th>${I('number', 15)}编号</th>
          <th>${I('customers', 15)}客户名称</th>
          <th>${I('phone', 15)}联系电话</th>
          <th>${I('tag', 15)}客户等级</th>
          <th>${I('building', 15)}所属行业</th>
          <th>${I('user', 15)}负责人</th>
          <th>${I('clock', 15)}最近更新</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <footer class="foot"><span>共 16 条</span><span class="sp">每页 20 条 ${I('chevDown', 12, 'mute')}<i class="pg">${I('chevRight', 14, 'flip')}</i><b>1</b><i class="pg">${I('chevRight', 14)}</i></span></footer>`;
}

function drawerPanel() {
  const r = record;
  const fu = r.followUps
    .map(
      (f) => `
      <li class="fu ${f.state}">
        <button class="done" aria-label="完成">${I('check', 14)}</button>
        <div><b>${esc(f.title)}</b><span>${esc(f.owner)} · ${esc(f.due)}</span></div>
        <span class="due ${f.state}">${esc(f.dueLabel)}</span>
        ${I('more', 18, 'mute')}
      </li>`
    )
    .join('');
  const act = r.activity
    .map((a) => `<li>${av(a.who, 20)}<p><b>${esc(a.who)}</b> ${esc(a.text)}</p><time>${esc(a.at)}</time></li>`)
    .join('');
  return `
  <aside class="panel">
    <div class="pbar">
      <span class="crumb">${I('customers', 16)}客户<i>/</i><b>#${r.no}</b></span>
      <div class="sp">
        <a class="ib">${I('up', 16)}</a><a class="ib">${I('down', 16)}</a>
        <a class="btn">${I('edit', 15)}编辑</a>
        <a class="ib">${I('more', 18)}</a><a class="ib">${I('close', 18)}</a>
      </div>
    </div>
    <div class="who-head">
      ${logo(r.name, 44)}
      <div>
        <h2>${esc(r.name)}</h2>
        <p>${grade(r.grade)}<span class="chip">${esc(r.industry)}</span><span class="meta">负责人 ${esc(r.owner)} · 更新于 ${esc(r.updated)}</span></p>
      </div>
    </div>
    <div class="psub"><div class="seg"><a class="on">概览</a><a>跟进<span>2</span></a><a>活动</a><a>关联<span>1</span></a></div></div>
    <div class="pbody">
      <section>
        <h3>属性</h3>
        <dl>
          <div><dt>${I('phone', 16)}联系电话</dt><dd class="tab-num">${esc(r.phone)}</dd></div>
          <div><dt>${I('tag', 16)}客户等级</dt><dd>${grade(r.grade)}</dd></div>
          <div><dt>${I('building', 16)}所属行业</dt><dd>${esc(r.industry)}</dd></div>
          <div><dt>${I('user', 16)}负责人</dt><dd class="who">${av(r.owner, 20)}${esc(r.owner)}</dd></div>
          <div><dt>${I('clock', 16)}创建时间</dt><dd>${esc(r.created)}</dd></div>
        </dl>
        <p class="note"><span>客户备注</span>${esc(r.note)}</p>
      </section>
      <section>
        <div class="sec-h"><h3>下一步跟进<span class="n">2</span></h3><a class="link">${I('plus', 14)}安排跟进</a></div>
        <ul class="fus">${fu}</ul>
      </section>
      <section>
        <div class="sec-h"><h3>活动</h3></div>
        <ul class="acts">${act}</ul>
        <div class="compose">${I('plus', 16)}追加活动记录…</div>
      </section>
    </div>
  </aside>`;
}

export function list() {
  return page({ title: '客户列表 · D', css: 'd.css', body: `<div class="app">${sidebar()}<main class="main">${listBody()}</main></div>` });
}

export function drawer() {
  return page({ title: '客户详情 · D', css: 'd.css', body: `<div class="app">${sidebar()}<main class="main">${listBody({ selectedNo: 1 })}${drawerPanel()}</main></div>` });
}

export function config() {
  const c = objectConfig;
  const rows = c.fields
    .map(
      (f) => `
      <tr class="${f.status === '已停用' ? 'off' : ''}">
        <td class="gr-h">${I('grip', 16, 'mute')}</td>
        <td><div class="fname"><b>${esc(f.name)}</b>${f.title ? '<span class="chip">记录名称</span>' : ''}${f.changed ? '<i class="dot-new" title="有未发布修改"></i>' : ''}</div></td>
        <td><code>${esc(f.key)}</code></td>
        <td><span class="ty">${I(f.typeIcon, 16)}${esc(f.type)}</span></td>
        <td>${f.required ? '<span class="chip req">必填</span>' : '<span class="soft">可留空</span>'}</td>
        <td><a class="sel-pill${f.access === '不可见' ? ' dim' : ''}">${esc(f.access)}${I('chevDown', 12, 'mute')}</a></td>
        <td><span class="st ${f.status === '已发布' ? 'ok' : f.status === '未发布' ? 'draft' : 'off'}"><i></i>${esc(f.status)}</span></td>
        <td class="end">${I('more', 18, 'mute')}</td>
      </tr>`
    )
    .join('');
  const changes = c.changes
    .map((x) => `<li><span class="chip">${esc(x.kind)}</span>${esc(x.text)}</li>`)
    .join('');
  const body = `
  <div class="app">${sidebar('设置')}
    <main class="main">
      <header class="bar">
        <span class="crumb big">设置${I('chevRight', 14, 'mute')}业务表${I('chevRight', 14, 'mute')}<b>${esc(c.name)}</b></span>
        <div class="sp">
          <a class="btn ghost">${I('eye', 16)}员工端预览</a>
          <a class="btn primary">${I('rocket', 16)}发布 ${c.pending} 项变更</a>
        </div>
      </header>
      <div class="strip">${I('info', 16)}<span>员工现在使用的是 <b>${c.version}</b>。草稿里有 ${c.pending} 项修改尚未发布，已发布的版本不可回滚。</span><a class="link">查看变更</a></div>
      <div class="obj-head">${logo(c.name, 40)}<div><h2>${esc(c.name)}</h2><p><code>${c.code}</code><span class="st ok"><i></i>已发布 ${c.version}</span></p></div></div>
      <div class="subbar"><div class="seg"><a>基本设置</a><a class="on">字段<span>8</span></a><a>列表视图</a><a>员工权限</a><a>流程</a><a>发布记录</a></div></div>
      <div class="scroll cfg">
        <table class="grid ledger">
          <thead><tr><th class="gr-h"></th><th>字段名称</th><th>字段键</th><th>数据类型</th><th>录入要求</th><th>员工访问</th><th>状态</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <a class="addrow">${I('plus', 16)}新建字段</a>
        <section class="changes"><h3>本次发布包含</h3><ul>${changes}</ul></section>
      </div>
    </main>
  </div>`;
  return page({ title: '字段配置 · D', css: 'd.css', body });
}
