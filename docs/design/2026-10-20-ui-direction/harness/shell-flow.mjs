// Sidebar and account-menu behaviour after the visual redesign: collapse, resize, mobile drawer,
// keyboard focus trap, account menu actions, and active-item state. Exits 1 if any check fails.
//   node shell-flow.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3300';
const T = '/workspace/nebula-demo';
const width = Number(widthArg);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width, height: width <= 390 ? 844 : 900 }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768,
  storageState: `/tmp/ui-env/state-${role}.json`,
});
const page = await context.newPage();
// Next's dev-mode badge sits over the bottom-left corner and swallows clicks there.
await page.addInitScript(() => { const css = document.createElement('style'); css.textContent = 'nextjs-portal{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css)); });
const sidebar = page.locator('aside').first();
const sidebarWidth = async () => Math.round((await sidebar.boundingBox())?.width ?? 0);
const roleLabel = role === 'admin' ? '公司管理员' : '员工';
const railByDefault = width >= 768 && width < 1200;

await run(`shell-flow ${role} ${width}`, browser, async (check) => {
  await page.goto(`${WEB}${T}/objects/customers`, { waitUntil: 'networkidle' });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no horizontal overflow', !(await overflow()));

  const mobile = width < 768;
  if (mobile) {
    check('sidebar is off screen until opened', !(await sidebar.isVisible()));
    await page.getByRole('button', { name: '打开导航' }).click();
    await sidebar.waitFor({ state: 'visible' });
    check('mobile drawer opens', await sidebar.isVisible());
  } else {
    check('desktop header strip is gone (page starts at the top)', (await page.locator('header').first().isHidden()) || (await page.locator('header').first().boundingBox())?.height < 4);
  }

  // Current item: one link marked, and it is the customers table.
  const current = sidebar.locator('a[aria-current="page"]');
  check('exactly one current nav item', (await current.count()) === 1, await current.count());
  check('current item is 客户', (((await current.first().textContent()) ?? '') + (await current.first().getAttribute('aria-label') ?? '')).includes('客户'));
  const bg = await current.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check('current item has a visible tint', bg !== 'rgba(0, 0, 0, 0)', bg);

  // Account block.
  const account = sidebar.getByRole('button', { name: new RegExp(roleLabel) });
  check('account block shows the role', (await account.count()) === 1);
  if (railByDefault) check('icon rail by default at this width', (await sidebarWidth()) === 64, await sidebarWidth());
  await account.click();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  check('account menu lists 账号与安全', (await menu.getByText('账号与安全').count()) > 0);
  check('account menu lists 切换工作空间', (await menu.getByText('切换工作空间').count()) > 0);
  check('account menu lists 退出登录', (await menu.getByText('退出登录').count()) > 0);
  check('account menu shows a masked phone', /\d{3}\*{4}\d{4}/.test((await menu.innerText())));
  await page.screenshot({ path: `${outDir}/${role}-${width}-account-menu.png` });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  check('Escape closes the account menu', true);

  if (mobile) {
    await page.keyboard.press('Escape');
    await sidebar.waitFor({ state: 'hidden' });
    check('Escape closes the mobile drawer', !(await sidebar.isVisible()));
    check('focus returns to the 打开导航 button', await page.getByRole('button', { name: '打开导航' }).evaluate((el) => el === document.activeElement));
  } else {
    // Collapse and expand.
    if (railByDefault) { await sidebar.getByRole('button', { name: '展开菜单' }).click(); await page.waitForTimeout(400); }
    const expanded = await sidebarWidth();
    check('expanded width within bounds', expanded >= 200 && expanded <= 320, expanded);
    await sidebar.getByRole('button', { name: '收起菜单' }).click();
    await page.waitForTimeout(400);
    check('collapses to the icon rail', (await sidebarWidth()) === 64, await sidebarWidth());
    check('collapsed items keep accessible names', (await sidebar.getByRole('link', { name: '客户' }).count()) === 1);
    check('collapsed account trigger keeps an accessible name', (await sidebar.getByRole('button', { name: new RegExp(roleLabel) }).count()) === 1);
    await page.screenshot({ path: `${outDir}/${role}-${width}-collapsed.png` });
    await sidebar.getByRole('button', { name: '展开菜单' }).click();
    await page.waitForTimeout(400);
    check('expands back', (await sidebarWidth()) === expanded, await sidebarWidth());

    // Drag to resize.
    // The resize handle is hidden below 1200px by design, so only look for it above that.
    const handle = page.getByRole('separator', { name: '调整侧栏宽度' });
    if (width < 1200) check('resize handle is hidden below 1200px', !(await handle.isVisible()));
    const box = width >= 1200 ? await handle.boundingBox() : null;
    if (width >= 1200 && box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(280, box.y + 300, { steps: 12 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(300);
      check('dragging to 280px sets that width', (await sidebarWidth()) === 280, await sidebarWidth());
      await handle.dblclick();
      await page.waitForTimeout(300);
      check('double-click restores the default width', (await sidebarWidth()) === 224, await sidebarWidth());
    }
  }

  // Logout through the account menu ends the session.
  if (mobile) await page.getByRole('button', { name: '打开导航' }).click();
  await sidebar.getByRole('button', { name: new RegExp(roleLabel) }).click();
  await page.getByRole('menu').getByText('退出登录').click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  check('退出登录 lands on the login page', page.url().includes('/login'), page.url());
});
