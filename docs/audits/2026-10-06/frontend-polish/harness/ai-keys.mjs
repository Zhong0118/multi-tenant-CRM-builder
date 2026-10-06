// Keyboard + failure checks for the conversation rail.
//   node ai-keys.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3200';
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
const active = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}]` : 'none';
});
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });

await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
if (width < 1200) {
  await page.getByRole('button', { name: '会话' }).click();
  await page.waitForTimeout(500);
}
const menu = page.getByRole('button', { name: /^会话操作：/ }).first();
const originalTitle = (await menu.getAttribute('aria-label')).replace('会话操作：', '');
log('first row', originalTitle);

// Keyboard: focus the row menu, open it with Enter, pick 重命名 with arrows.
await menu.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
log('menu open, focus', await active());
for (let i = 0; i < 3 && !(await active()).includes('重命名'); i += 1) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
log('rename dialog open', await page.getByRole('dialog', { name: '重命名会话' }).isVisible(), 'focus', await active());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
log('after Esc rename dialog visible', await page.getByRole('dialog', { name: '重命名会话' }).isVisible().catch(() => false), 'dialogs left', await page.getByRole('dialog').count(), 'focus', await active());

// Rename failure keeps the dialog and the typed title.
await page.route('**/ai/conversations/*', (route) =>
  route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: '会话服务暂时不可用', requestId: 'req-polish-rename' }) })
    : route.continue());
await menu.click();
await page.getByRole('menuitem', { name: '重命名' }).click();
const input = page.getByRole('textbox', { name: '会话名称' });
await input.fill('季度复盘（改名测试）');
await input.press('Enter');
await page.waitForTimeout(800);
log('after failed save: dialog', await page.getByRole('dialog', { name: '重命名会话' }).isVisible(),
  'value', await input.inputValue(), 'alert', await page.getByRole('dialog').getByRole('alert').textContent().catch(() => null));
await shot('rename-failed');

// Success path.
await page.unroute('**/ai/conversations/*');
await page.getByRole('button', { name: '保存' }).click();
await page.waitForTimeout(1200);
log('after save: dialog', await page.getByRole('dialog', { name: '重命名会话' }).isVisible().catch(() => false),
  'row renamed', await page.getByRole('button', { name: '会话操作：季度复盘（改名测试）' }).count());

// Delete asks first; cancel keeps the row.
const renamed = page.getByRole('button', { name: '会话操作：季度复盘（改名测试）' });
await renamed.click();
await page.getByRole('menuitem', { name: '删除' }).click();
await page.waitForTimeout(400);
await shot('delete-confirm');
log('delete dialog', await page.getByRole('dialog', { name: '删除这个会话？' }).isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
log('after cancel row still there', await renamed.count(), 'focus', await active());

// Restore the title so the fixture stays recognisable.
await renamed.click();
await page.getByRole('menuitem', { name: '重命名' }).click();
await page.getByRole('textbox', { name: '会话名称' }).fill(originalTitle);
await page.getByRole('button', { name: '保存' }).click();
await page.waitForTimeout(1000);
log('restored', await page.getByRole('button', { name: `会话操作：${originalTitle}` }).count() > 0);

// Lost-input check: switching conversations keeps the composer draft rule visible.
await browser.close();
