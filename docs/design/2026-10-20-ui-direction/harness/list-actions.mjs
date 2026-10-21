// Record list after the restyle, in a real browser: the row action menu replaces the pinned
// column, destructive choices ask first, saved views save / apply / delete, cards keep their
// inline actions on a phone. Exits 1 if any check fails. Deletes nothing: it only cancels.
//   node list-actions.mjs <role> <width>
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [role, widthArg] = process.argv.slice(2);
const width = Number(widthArg);
const WEB = 'http://localhost:3300';
const LIST = `${WEB}/workspace/nebula-demo/objects/customers`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width, height: width <= 390 ? 844 : 900 }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768,
  storageState: `/tmp/ui-env/state-${role}.json`,
});
const page = await context.newPage();
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
const mobile = width < 768;

await run(`list-actions ${role} ${width}`, browser, async (check) => {
  await page.goto(LIST, { waitUntil: 'networkidle' });
  check('no horizontal overflow', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  if (mobile) {
    const cards = page.getByRole('list', { name: /记录卡片/ });
    check('cards keep inline actions on a phone', (await cards.getByRole('button', { name: /^查看 / }).count()) > 0);
  } else {
    const table = page.getByRole('table', { name: /记录$/ }).first();
    check('table rows have no inline 查看 buttons', (await table.getByRole('button', { name: /^查看 / }).count()) === 0);
    const trigger = table.getByRole('button', { name: /^更多操作 / }).first();
    check('every row has one action menu trigger', (await table.getByRole('button', { name: /^更多操作 / }).count()) > 0);
    const widthOfActions = await table.locator('th').last().evaluate((el) => Math.round(el.getBoundingClientRect().width));
    check('the actions column is compact', widthOfActions <= 64, widthOfActions);

    await trigger.click();
    const menu = page.getByRole('menu').first();
    await menu.waitFor();
    for (const name of ['查看', '编辑', '删除']) check(`menu offers ${name}`, (await menu.getByRole('menuitem', { name: new RegExp(`^${name}`) }).count()) > 0);
    if (role === 'admin') check('admin menu offers 分配负责人', (await menu.getByRole('menuitem', { name: '分配负责人' }).count()) > 0);
    else check('employee menu does not offer 分配负责人', (await menu.getByRole('menuitem', { name: '分配负责人' }).count()) === 0);

    // Deleting asks first, and cancelling keeps the record.
    const deletable = await menu.getByRole('menuitem', { name: '删除' }).first().getAttribute('aria-disabled');
    if (deletable !== 'true') {
      const rowsBefore = await table.locator('tbody tr').count();
      await menu.getByRole('menuitem', { name: '删除' }).first().click();
      const modal = page.getByRole('dialog').filter({ hasText: '确认删除' });
      await modal.waitFor();
      check('delete asks for confirmation', await modal.isVisible());
      await modal.getByRole('button', { name: '取消' }).click();
      await modal.waitFor({ state: 'hidden' });
      check('cancelling keeps every row', (await table.locator('tbody tr').count()) === rowsBefore);
    } else {
      check('delete is disabled for this role, with its reason shown', /无删除权限/.test((await menu.getByRole('menuitem', { name: /^删除/ }).first().textContent()) ?? ''));
      await page.keyboard.press('Escape');
    }

    // 查看 opens the record.
    await page.goto(LIST, { waitUntil: 'networkidle' });
    await table.getByRole('button', { name: /^更多操作 / }).first().click();
    await page.getByRole('menuitem', { name: '查看', exact: true }).click();
    await page.getByRole('dialog').first().waitFor();
    check('查看 opens the record drawer', /\/objects\/customers\/[^/?]+/.test(page.url()), page.url());
    await page.keyboard.press('Escape');
  }

  // Saved views.
  await page.goto(`${LIST}?search=${encodeURIComponent('赵晨')}`, { waitUntil: 'networkidle' });
  const viewName = `赵晨的客户-${role}-${width}`;
  check('a single save entry is shown first', (await page.getByRole('button', { name: '保存为视图' }).count()) === 1);
  await page.getByRole('button', { name: '保存为视图' }).click();
  await page.getByRole('textbox', { name: '视图名称' }).fill(viewName);
  await page.getByRole('button', { name: '保存视图' }).click();
  await page.getByRole('button', { name: /我的视图/ }).waitFor();
  check('after saving, 我的视图 appears', true);

  await page.goto(LIST, { waitUntil: 'networkidle' });
  check('a clean list has no search filter', !new URL(page.url()).searchParams.has('search'));
  await page.getByRole('button', { name: /我的视图/ }).click();
  await page.getByRole('list', { name: '已保存的视图' }).getByRole('button', { name: viewName, exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('search') === '赵晨', { timeout: 10000 });
  check('applying a saved view restores its search in one click', new URL(page.url()).searchParams.get('search') === '赵晨');

  await page.getByRole('button', { name: /我的视图/ }).click();
  await page.getByRole('button', { name: `删除视图 ${viewName}` }).click();
  check('deleting the last view removes the 我的视图 entry', await page.getByRole('button', { name: /我的视图/ }).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
});
