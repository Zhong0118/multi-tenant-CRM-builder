// Core record flows: navigation, search, detail open/close, edit error recovery,
// follow-up dialog keyboard handling.
//   node core-flow.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

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
const log = (...a) => console.log(...a);
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
const active = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24)}]` : 'none';
});
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

// 1. Navigation from home through the sidebar.
await page.goto(`${WEB}${T}`, { waitUntil: 'networkidle' });
if (width < 768) {
  await page.locator('header button').first().click();
  await page.waitForTimeout(400);
}
await page.getByRole('link', { name: '客户', exact: true }).first().click();
await page.waitForURL(/objects\/customers/);
await page.waitForLoadState('networkidle');
log('nav ->', new URL(page.url()).pathname, 'h1', await page.getByRole('heading', { level: 1 }).first().textContent());

// 2. Search keeps the term in the URL and narrows rows.
const rowsBefore = await page.getByRole('link', { name: /^客户 / }).count();
const search = page.getByPlaceholder(/搜索客户名称/);
await search.fill('赵晨');
await search.press('Enter');
await page.waitForTimeout(1200);
await page.waitForLoadState('networkidle');
const names = await page.getByRole('link', { name: /^客户 / }).allTextContents();
log('search rows', rowsBefore, '->', names.length, 'all match', names.every((n) => n.includes('赵晨')), 'url', new URL(page.url()).search);
const listUrl = page.url();

// 3. Open the detail, close with Escape, focus and URL come back.
const link = page.getByRole('link', { name: '客户 赵晨-1' }).first();
await link.click();
const drawer = page.getByRole('dialog').first();
await drawer.waitFor();
await page.waitForTimeout(500);
log('detail open', await drawer.isVisible(), 'overflowX', await overflow());
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
log('after Esc drawer', await drawer.isVisible().catch(() => false), 'url back to list', page.url() === listUrl, 'focus', await active());

// 4. Edit, fail the save, keep the input, then save for real and restore.
await page.getByRole('link', { name: '客户 赵晨-1' }).first().click();
await drawer.waitFor();
await page.waitForTimeout(400);
const canEdit = await page.getByRole('button', { name: /^编\s*辑$/ }).count();
if (canEdit) {
  await page.getByRole('button', { name: /^编\s*辑$/ }).click();
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
  log('failed save alert', await drawer.getByRole('alert').first().textContent().catch(() => null),
    'input kept', (await note.inputValue()) === draft, 'still editing', await page.getByRole('button', { name: '保存修改' }).isVisible());
  await shot('edit-failed');
  await page.unroute('**/records/**');
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForTimeout(1500);
  log('saved: shows draft', await drawer.getByText(draft).count() > 0, 'form closed', !(await page.getByRole('button', { name: '保存修改' }).isVisible().catch(() => false)));
  // Restore the fixture value.
  await page.getByRole('button', { name: /^编\s*辑$/ }).click();
  await page.getByRole('textbox', { name: '客户备注', exact: true }).fill(original);
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.waitForTimeout(1500);
  log('restored', await drawer.getByText(original, { exact: true }).count() > 0);
} else {
  log('edit not offered for this role');
}

// 5. Follow-up dialog: opens with focus inside, Escape returns focus to its trigger.
const reschedule = drawer.getByRole('button', { name: /^改\s*期$/ }).first();
if (await reschedule.count()) {
  await reschedule.scrollIntoViewIfNeeded();
  await reschedule.click();
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog', { name: '调整跟进时间' });
  log('reschedule dialog', await dialog.isVisible(), 'focus inside', await dialog.evaluate((d) => d.contains(document.activeElement)));
  await shot('reschedule');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  log('after Esc dialog', await dialog.isVisible().catch(() => false), 'focus', await active(), 'overflowX', await overflow());
} else {
  log('no follow-up to reschedule');
}
await browser.close();
