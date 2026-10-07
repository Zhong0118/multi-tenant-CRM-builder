// Keyboard + failure checks for the conversation rail. Exits 1 if any check fails.
//   node ai-keys.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

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
const active = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)}]` : 'none';
});
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
const RENAMED = '季度复盘（改名测试）';

await run(`ai-keys ${role} ${width}`, browser, async (check) => {
  await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if (width < 1200) {
    await page.getByRole('button', { name: '会话' }).click();
    await page.waitForTimeout(500);
  }
  const menu = page.getByRole('button', { name: /^会话操作：/ }).first();
  await menu.waitFor();
  const originalTitle = (await menu.getAttribute('aria-label')).replace('会话操作：', '');
  const menuLabel = `button[会话操作：${originalTitle}]`;

  // Keyboard: focus the row menu, open it with Enter, pick 重命名 with arrows.
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const menuFocus = await active();
  check('keyboard-opened menu focuses its first item', menuFocus.includes('重命名'), menuFocus);
  for (let i = 0; i < 3 && !(await active()).includes('重命名'); i += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' });
  check('rename dialog opens', await renameDialog.isVisible());
  const dialogFocus = await active();
  check('rename dialog focuses the title input', dialogFocus.startsWith('input'), dialogFocus);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Esc closes the rename dialog', !(await renameDialog.isVisible().catch(() => false)));
  // The narrow rail itself is a dialog (drawer); it must stay open.
  check('Esc closes only the rename dialog', (await page.getByRole('dialog').count()) === (width < 1200 ? 1 : 0));
  const afterEsc = await active();
  check('focus returns to the row menu button', afterEsc === menuLabel, afterEsc);

  // Rename failure keeps the dialog and the typed title.
  await page.route('**/ai/conversations/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: '会话服务暂时不可用', requestId: 'req-polish-rename' }) })
      : route.continue());
  await menu.click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const input = page.getByRole('textbox', { name: '会话名称' });
  await input.fill(RENAMED);
  await input.press('Enter');
  await page.waitForTimeout(800);
  check('failed rename keeps the dialog', await renameDialog.isVisible());
  check('failed rename keeps the typed title', (await input.inputValue()) === RENAMED);
  const alert = await renameDialog.getByRole('alert').textContent().catch(() => null);
  check('failed rename shows the server reason and request id',
    !!alert && alert.includes('会话服务暂时不可用') && alert.includes('req-polish-rename'), alert);
  await shot('rename-failed');

  // Success path.
  await page.unroute('**/ai/conversations/*');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(1200);
  const renamed = page.getByRole('button', { name: `会话操作：${RENAMED}` });
  check('successful rename closes the dialog', !(await renameDialog.isVisible().catch(() => false)));
  check('row shows the new title', (await renamed.count()) === 1);

  // Delete asks first; cancel keeps the row.
  await renamed.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.waitForTimeout(400);
  await shot('delete-confirm');
  const deleteDialog = page.getByRole('dialog', { name: '删除这个会话？' });
  check('delete asks for confirmation', await deleteDialog.isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('cancelled delete keeps the row', (await renamed.count()) === 1);
  const afterCancel = await active();
  check('focus returns after cancelling delete', afterCancel === `button[会话操作：${RENAMED}]`, afterCancel);

  // Restore the title so the fixture stays recognisable.
  await renamed.click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill(originalTitle);
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(1000);
  check('fixture title restored', (await page.getByRole('button', { name: `会话操作：${originalTitle}` }).count()) > 0);
});
