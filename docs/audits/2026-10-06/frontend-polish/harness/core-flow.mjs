// Core record flows: navigation, search, detail open/close, edit error recovery,
// follow-up dialog keyboard handling. Exits 1 if any check fails.
//   node core-flow.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3200';
const T = '/workspace/nebula-demo';
const width = Number(widthArg);
const height = width <= 390 ? 844 : 900;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768,
  storageState: `/tmp/crm-polish/state-${role}.json`,
});
const page = await context.newPage();
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
const active = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24)}]` : 'none';
});
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

await run(`core-flow ${role} ${width}`, browser, async (check) => {
  // 1. Navigation from home through the sidebar.
  await page.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
  if (width < 768) {
    await page.locator('header button').first().click();
    await page.waitForTimeout(400);
  }
  await page.getByRole('link', { name: '客户', exact: true }).first().click();
  await page.waitForURL(/objects\/customers/);
  await page.waitForLoadState('networkidle');
  const h1 = (await page.getByRole('heading', { level: 1 }).first().textContent())?.trim();
  check('sidebar opens the customer list', h1 === (role === 'employee' ? '我的客户' : '客户'), h1);

  // 2. Search keeps the term in the URL and narrows rows.
  const rowsBefore = await page.getByRole('link', { name: /^客户 / }).count();
  const search = page.getByPlaceholder(/搜索客户名称/);
  await search.fill('赵晨');
  await search.press('Enter');
  await page.waitForTimeout(1200);
  await page.waitForLoadState('networkidle');
  const names = await page.getByRole('link', { name: /^客户 / }).allTextContents();
  check('search returns rows', names.length > 0 && names.length <= rowsBefore, { before: rowsBefore, after: names.length });
  check('every search row matches', names.every((n) => n.includes('赵晨')), names);
  check('search term kept in URL', new URL(page.url()).searchParams.get('search') === '赵晨', new URL(page.url()).search);
  const listUrl = page.url();

  // 3. Open the detail, close with Escape, focus and URL come back.
  const link = page.getByRole('link', { name: '客户 赵晨-1' }).first();
  await link.click();
  const drawer = page.getByRole('dialog').first();
  await drawer.waitFor();
  await page.waitForTimeout(500);
  check('detail opens without horizontal overflow', !(await overflow()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  check('Esc closes the detail', !(await drawer.isVisible().catch(() => false)));
  check('URL returns to the list', page.url() === listUrl, page.url());
  const focusAfterClose = await active();
  check('focus returns to the record row', focusAfterClose === 'a[客户 赵晨-1]', focusAfterClose);

  // 4. Edit, fail the save, keep the input, then save for real and restore.
  await page.getByRole('link', { name: '客户 赵晨-1' }).first().click();
  await drawer.waitFor();
  await page.waitForTimeout(400);
  const owner = await drawer.getByText(/^负责人：/).first().textContent().catch(() => null);
  if (role === 'employee') check('employee sees themselves as owner', owner === '负责人：我', owner);
  else check('admin sees the owner by name', !!owner && owner !== '负责人：我' && owner !== '负责人：已指定', owner);
  const editButton = page.getByRole('button', { name: /^编\s*辑$/ });
  check('edit is offered', (await editButton.count()) > 0);
  await editButton.click();
  const note = page.getByRole('textbox', { name: '客户备注', exact: true });
  const original = await note.inputValue();
  const draft = `${original}（回归检查）`;
  await note.fill(draft);
  await page.route('**/records/**', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: '保存服务暂时不可用', requestId: 'req-polish-check' }) })
      : route.continue());
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForTimeout(900);
  const alert = await drawer.getByRole('alert').first().textContent().catch(() => null);
  check('failed save shows the server reason and request id', !!alert && alert.includes('保存服务暂时不可用') && alert.includes('req-polish-check'), alert);
  check('failed save keeps the input', (await note.inputValue()) === draft);
  check('failed save stays in edit mode', await page.getByRole('button', { name: '保存修改' }).isVisible());
  await shot('edit-failed');
  await page.unroute('**/records/**');
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForTimeout(1500);
  check('retried save shows the new value', (await drawer.getByText(draft).count()) > 0);
  check('retried save closes the form', !(await page.getByRole('button', { name: '保存修改' }).isVisible().catch(() => false)));
  // Restore the fixture value.
  await page.getByRole('button', { name: /^编\s*辑$/ }).click();
  await page.getByRole('textbox', { name: '客户备注', exact: true }).fill(original);
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForTimeout(1500);
  check('fixture value restored', (await drawer.getByText(original, { exact: true }).count()) > 0);

  // 5. Follow-up dialog: opens with focus inside, Escape returns focus to its trigger.
  const reschedule = drawer.getByRole('button', { name: /^改\s*期$/ }).first();
  check('record has a follow-up to reschedule', (await reschedule.count()) > 0);
  await reschedule.scrollIntoViewIfNeeded();
  await reschedule.click();
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog', { name: '调整跟进时间' });
  check('reschedule dialog opens', await dialog.isVisible());
  check('focus moves into the dialog', await dialog.evaluate((d) => d.contains(document.activeElement)));
  await shot('reschedule');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check('Esc closes the dialog', !(await dialog.isVisible().catch(() => false)));
  const focusAfterDialog = await active();
  check('focus returns to 改期', /^button\[改\s*期\]$/.test(focusAfterDialog), focusAfterDialog);
  check('no horizontal overflow', !(await overflow()));
});
