// Direction C — "内嵌数据表" (shadcn/ui-leaning). Monochrome: black action, zinc greys, colour only for status.
// The content sits in one inset rounded surface; filters are dashed faceted buttons; pagination in the footer.
import { icon, esc, page } from './icons.mjs';
import { company, me, nav, customers, record, objectConfig } from './data.mjs';

const I = (k, s = 16, c = '') => icon('lucide', k, s, c);
const av = (name, size = 24) => `<span class="av" style="--s:${size}px">${esc(name.slice(-1))}</span>`;
// Grade as status: filled / half / empty circle, same idea as the Status column in the shadcn tasks table.
const dot = (g) => {
  const fill = { A: '<circle cx="8" cy="8" r="6.25" fill="currentColor"/>', B: '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor"/>', C: '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>' }[g];
  return `<svg class="gdot" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${fill}</svg>`;
};

function sidebar(active = '客户') {
  return `
  <aside class="side">
    <div class="team"><span class="tile">${company.mark}</span><div><b>${esc(company.name)}</b><span>nebula-demo</span></div>${I('chevUpDown', 16, 'mute push')}</div>
    <nav>
      ${nav
        .map(
          (g) => `
      <div class="grp">${esc(g.group)}</div>
      ${g.items.map((i) => `<a class="item${i.label === active ? ' on' : ''}">${I(i.icon, 16)}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</a>`).join('')}`
        )
        .join('')}
    </nav>
    <div class="me">${av(me.name, 32)}<div><b>${esc(me.name)}</b><span>${esc(me.role)}</span></div>${I('chevUpDown', 16, 'mute push')}</div>
  </aside>`;
}

function topbar(trail) {
  return `<header class="top"><a class="ib">${I('sidebar', 16)}</a><i class="vsep"></i><span class="crumb">${trail
    .map((t, i) => (i === trail.length - 1 ? `<b>${esc(t)}</b>` : `${esc(t)}${I('chevRight', 14)}`))
    .join(' ')}</span></header>`;
}

const PAGE_SIZE = 10;

function listContent() {
  const rows = customers
    .slice(0, PAGE_SIZE)
    .map(
      (c) => `
      <tr>
        <td class="ck"><i class="box"></i></td>
        <td class="mut">${c.no}</td>
        <td><b>${esc(c.name)}</b></td>
        <td class="num">${esc(c.phone)}</td>
        <td><span class="stat">${dot(c.grade)}${c.grade} 级</span></td>
        <td><span class="badge">${esc(c.industry)}</span></td>
        <td><span class="who">${av(c.owner)}${esc(c.owner)}</span></td>
        <td class="mut">${esc(c.updated)}</td>
        <td class="end">${I('more', 16, 'mute')}</td>
      </tr>`
    )
    .join('');
  const sortable = (t) => `<span class="sortable">${t}${I('chevUpDown', 14)}</span>`;
  return `
    <div class="content">
      <div class="title"><h1>客户</h1>
        <div class="sp"><a class="btn">${I('pool', 16)}公共池<span class="count">3</span></a><a class="btn primary">${I('plus', 16)}新建客户</a></div>
      </div>
      <div class="tools">
        <div class="find">${I('search', 16)}<span>搜索客户名称、电话、行业…</span></div>
        <a class="facet">${I('circlePlus', 16)}负责人</a>
        <a class="facet">${I('circlePlus', 16)}客户等级</a>
        <a class="facet">${I('circlePlus', 16)}所属行业</a>
        <a class="facet">${I('circlePlus', 16)}归属状态</a>
        <div class="sp"><a class="btn">${I('columns', 16)}视图</a><a class="btn icon">${I('more', 16)}</a></div>
      </div>
      <div class="frame">
        <table>
          <thead><tr>
            <th class="ck"><i class="box"></i></th>
            <th>编号</th><th>${sortable('客户名称')}</th><th>联系电话</th><th>${sortable('客户等级')}</th><th>所属行业</th><th>负责人</th><th>${sortable('最近更新')}</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="pager">
        <span class="mut">已选择 0 / 16 行</span>
        <div class="sp"><span>每页行数</span><a class="btn sm">10${I('chevDown', 14)}</a><span class="pageof">第 1 / 2 页</span>
          <a class="btn icon sm off">${I('chevRight', 16, 'flip')}</a><a class="btn icon sm">${I('chevRight', 16)}</a></div>
      </div>
    </div>`;
}

function sheet() {
  const r = record;
  const fu = r.followUps
    .map(
      (f) => `
      <li>
        <button class="check" aria-label="完成"></button>
        <div><b>${esc(f.title)}</b><span>${esc(f.owner)} · ${esc(f.due)}</span></div>
        <span class="badge ${f.state === 'overdue' ? 'bad' : ''}">${esc(f.dueLabel)}</span>
      </li>`
    )
    .join('');
  return `
  <div class="scrim"></div>
  <aside class="sheet">
    <a class="x">${I('close', 18)}</a>
    <header>
      <h2>${esc(r.name)}</h2>
      <p>客户 · #${r.no} · 更新于 ${esc(r.updated)}</p>
    </header>
    <div class="tabsx"><a class="on">详情</a><a>跟进<span>2</span></a><a>活动</a><a>关联<span>1</span></a></div>
    <div class="sbody">
      <dl class="grid2">
        <div><dt>联系电话</dt><dd class="num">${esc(r.phone)}</dd></div>
        <div><dt>客户等级</dt><dd><span class="stat">${dot(r.grade)}${r.grade} 级</span></dd></div>
        <div><dt>所属行业</dt><dd><span class="badge">${esc(r.industry)}</span></dd></div>
        <div><dt>负责人</dt><dd><span class="who">${av(r.owner, 22)}${esc(r.owner)}</span></dd></div>
        <div class="wide"><dt>客户备注</dt><dd class="body">${esc(r.note)}</dd></div>
      </dl>
      <div class="sech"><h3>下一步跟进</h3><span>2 项 · 1 项已逾期</span></div>
      <ul class="fucard">${fu}</ul>
      <div class="sech"><h3>最近活动</h3><span>共 3 条</span></div>
      <ul class="recent">${r.activity.map((a) => `<li><span><b>${esc(a.who)}</b> ${esc(a.text)}</span><time>${esc(a.at)}</time></li>`).join('')}</ul>
    </div>
    <footer><a class="btn danger">${I('trash', 16)}删除</a><a class="btn primary">${I('edit', 16)}编辑</a></footer>
  </aside>`;
}

export function list() {
  return page({ title: '客户列表 · C', css: 'c.css', body: `<div class="app">${sidebar()}<div class="inset">${topbar(['业务数据', '客户'])}${listContent()}</div></div>` });
}

export function drawer() {
  return page({ title: '客户详情 · C', css: 'c.css', body: `<div class="app">${sidebar()}<div class="inset">${topbar(['业务数据', '客户'])}${listContent()}</div>${sheet()}</div>` });
}

export function config() {
  const c = objectConfig;
  const rows = c.fields
    .map(
      (f) => `
      <tr class="${f.status === '已停用' ? 'offrow' : ''}">
        <td class="gp">${I('grip', 16, 'mute')}</td>
        <td><div class="fn"><b>${esc(f.name)}</b>${f.title ? '<span class="badge">记录名称</span>' : ''}<code>${esc(f.key)}</code></div></td>
        <td><span class="ty">${I(f.typeIcon, 16)}${esc(f.type)}</span></td>
        <td><span class="sw${f.required ? ' on' : ''}"><i></i></span></td>
        <td><a class="btn sm sel">${esc(f.access)}${I('chevUpDown', 14, 'mute')}</a></td>
        <td><span class="badge ${f.status === '已发布' ? '' : f.status === '未发布' ? 'draft' : 'mutedb'}">${esc(f.status)}</span></td>
        <td class="end">${I('more', 16, 'mute')}</td>
      </tr>`
    )
    .join('');
  const body = `
  <div class="app">${sidebar('设置')}
    <div class="inset">${topbar(['设置', '业务表', c.name])}
      <div class="content">
        <div class="title"><h1>${esc(c.name)}<span class="badge">${c.version} 已发布</span></h1>
          <div class="sp"><a class="btn">${I('eye', 16)}员工端预览</a><a class="btn primary">${I('rocket', 16)}发布 ${c.pending} 项变更</a></div>
        </div>
        <div class="alert">${I('info', 16)}<div><b>有 ${c.pending} 项修改尚未发布</b><span>员工仍在使用 ${c.version}。已发布的版本不可回滚。</span></div><a class="lnk">查看变更</a></div>
        <div class="settings">
          <nav class="subnav"><a>基本设置</a><a class="on">字段</a><a>列表视图</a><a>员工权限</a><a>流程</a><a>发布记录</a></nav>
          <section>
            <div class="sh"><div><h2>字段</h2><p>拖动调整顺序。字段键发布后不能更改。</p></div><a class="btn">${I('plus', 16)}新建字段</a></div>
            <div class="frame">
              <table class="fields">
                <thead><tr><th></th><th>字段名称</th><th>数据类型</th><th>必填</th><th>员工访问</th><th>状态</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>`;
  return page({ title: '字段配置 · C', css: 'c.css', body });
}
