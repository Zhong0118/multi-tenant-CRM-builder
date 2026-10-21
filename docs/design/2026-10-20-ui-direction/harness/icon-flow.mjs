// Business-table icon, end to end against the real API and database: choose in the designer,
// save, confirm employees keep the old icon until publish, publish, confirm admin and employee
// sidebars update, then restore the default. Exits 1 if any check fails.
//   node icon-flow.mjs <outDir>
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [outDir] = process.argv.slice(2);
const WEB = 'http://localhost:3300';
const T = '/workspace/nebula-demo';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const open = async (role) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: `/tmp/ui-env/state-${role}.json` });
  const page = await context.newPage();
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
  return page;
};
const sidebarIcon = (page, name) => page.locator('aside nav[aria-label="业务数据"] a', { hasText: name }).first().locator('[data-icon]').getAttribute('data-icon');

const isPublish = (r) => r.request().method() === 'POST' && /\/object-definitions\/[^/]+\/publications$/.test(new URL(r.url()).pathname);
async function publish(page, check, label) {
  await page.getByRole('button', { name: '发布变更' }).first().click();
  const dialog = page.getByRole('dialog', { name: '发布配置变更' });
  await dialog.waitFor();
  const done = page.waitForResponse(isPublish, { timeout: 20000 });
  await dialog.getByRole('button', { name: '确认发布' }).click();
  const response = await done;
  check(`${label}: publish request succeeds`, response.ok(), response.status());
  await dialog.waitFor({ state: 'hidden' });
}

await run('icon-flow', browser, async (check) => {
  const admin = await open('admin');
  const employee = await open('employee');

  // Start from a known state: the default icon, published.
  await admin.goto(`${WEB}${T}/settings/objects`, { waitUntil: 'networkidle' });
  const link = admin.locator('main').getByRole('link', { name: '客户', exact: true }).first();
  const designerUrl = await link.getAttribute('href');
  await link.click();
  await admin.waitForLoadState('networkidle');
  await admin.getByRole('button', { name: '基本设置' }).click();
  const group = admin.getByRole('radiogroup', { name: '业务表图标' });
  await group.waitFor();
  check('picker offers the default plus 35 icons', (await group.getByRole('radio').count()) === 36, await group.getByRole('radio').count());
  await admin.screenshot({ path: `${outDir}/designer-picker-before.png` });

  const startIcon = await sidebarIcon(admin, '客户');
  check('sidebar starts with the default table icon', startIcon === 'table', startIcon);

  // Choose and save.
  await group.getByRole('radio', { name: '团队' }).click();
  check('chosen icon is marked selected', (await group.getByRole('radio', { name: '团队' }).getAttribute('aria-checked')) === 'true');
  await admin.getByRole('button', { name: '保存基本设置' }).click();
  await admin.getByText('基本设置已保存').first().waitFor({ timeout: 15000 });
  check('saving the basics reports success', true);

  // Persisted in the draft.
  await admin.goto(`${WEB}${designerUrl}`, { waitUntil: 'networkidle' });
  await admin.getByRole('button', { name: '基本设置' }).click();
  const reloaded = admin.getByRole('radiogroup', { name: '业务表图标' });
  check('the draft keeps the icon after a reload', (await reloaded.getByRole('radio', { name: '团队' }).getAttribute('aria-checked')) === 'true');
  check('the draft is marked as having unpublished changes', (await admin.getByText(/有未发布变更/).count()) > 0);

  // Not live until published.
  await employee.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
  const beforePublish = await sidebarIcon(employee, '客户');
  check('employees keep the old icon until publish', beforePublish === 'table', beforePublish);

  // Publish.
  await publish(admin, check, 'first publish');

  // Live for both roles.
  await admin.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
  const adminIcon = await sidebarIcon(admin, '客户');
  check('admin sidebar shows the chosen icon', adminIcon === 'team', adminIcon);
  await admin.screenshot({ path: `${outDir}/sidebar-after-publish.png` });
  await employee.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
  const employeeIcon = await sidebarIcon(employee, '客户');
  check('employee sidebar shows the chosen icon', employeeIcon === 'team', employeeIcon);
  const otherIcon = await sidebarIcon(employee, '销售线索');
  check('other tables keep the default icon', otherIcon === 'table', otherIcon);

  // The settings list shows it too.
  await admin.goto(`${WEB}${T}/settings/objects`, { waitUntil: 'networkidle' });
  const listIcon = await admin.locator('main').getByRole('link', { name: '客户', exact: true }).first().locator('[data-icon]').getAttribute('data-icon');
  check('the business-table list shows the icon', listIcon === 'team', listIcon);

  // Restore the default and publish, so the fixture ends as it began.
  await admin.goto(`${WEB}${designerUrl}`, { waitUntil: 'networkidle' });
  await admin.getByRole('button', { name: '基本设置' }).click();
  await admin.getByRole('radiogroup', { name: '业务表图标' }).getByRole('radio', { name: '默认' }).click();
  await admin.getByRole('button', { name: '保存基本设置' }).click();
  await admin.getByText('基本设置已保存').first().waitFor({ timeout: 15000 });
  await publish(admin, check, 'restore publish');
  await admin.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
  const restored = await sidebarIcon(admin, '客户');
  check('clearing the icon restores the default after publishing', restored === 'table', restored);
});
