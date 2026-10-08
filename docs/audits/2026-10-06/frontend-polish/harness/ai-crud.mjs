// Conversation create / retry / switch / delete against the local mock provider.
// Exits 1 if any check fails.
//   node ai-crud.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3200';
const width = Number(widthArg);
const height = width <= 390 ? 844 : 900;
const narrow = width < 1200;
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
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const conversationParam = () => new URL(page.url()).searchParams.get('conversation');
const composer = () => page.locator('textarea').first();
async function openRail() {
  if (!narrow) return;
  await page.getByRole('button', { name: /会\s?话/ }).first().click();
  await page.waitForTimeout(500);
}
// Question bubbles in the transcript, leaving out the rail rows named after them.
const bubbles = (text) => page.evaluate((t) => Array.from(document.querySelectorAll('main *'))
  .filter((el) => !el.closest('aside') && !el.closest('button')
    && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() === t)).length, text);
// Rows the user can see. Below 1200px the rail is a drawer and the desktop
// copy stays in the DOM hidden, so open the drawer and count visible rows.
async function railRows(text) {
  await openRail();
  const rows = await page.locator(`button[title="${text}"]:visible`).count();
  if (narrow) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  return rows;
}

await run(`ai-crud ${role} ${width}`, browser, async (check) => {
  await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 1. 新建会话 starts an empty conversation.
  await openRail();
  await page.getByRole('button', { name: /新建会话/ }).click();
  await page.waitForTimeout(600);
  check('new conversation has no conversation param', conversationParam() === null, conversationParam());
  check('new conversation starts with an empty composer', (await composer().inputValue()) === '');
  check('new conversation shows no messages', (await page.locator('time').count()) === 0);

  // 2. A failed turn offers 重试; retrying answers without repeating the question.
  const question = `这次一次失败的复盘 ${Date.now() % 100000}`;
  await composer().fill(question);
  await composer().press('Enter');
  const retry = page.getByRole('button', { name: /^重\s?试$/ }).last();
  await retry.waitFor({ timeout: 60000 });
  check('failed turn shows the provider error', (await page.getByText('AI 服务暂时不可用，请稍后重试').count()) === 1);
  check('failed turn clears the composer', (await composer().inputValue()) === '');
  await shot('crud-failed');
  await retry.click();
  await page.getByText('回答已完成').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const ours = conversationParam();
  check('retry completes the answer', (await page.getByText('回答已完成').count()) > 0);
  check('retried answer replaces the failure', (await page.getByText('AI 服务暂时不可用，请稍后重试').count()) === 0);
  check('question appears once after retry', (await bubbles(question)) === 1, await bubbles(question));
  const rows = await railRows(question);
  check('conversation appears once in the rail', rows === 1, rows);
  check('retry button is gone', !(await page.getByRole('button', { name: /^重\s?试$/ }).count()));
  check('retried turn has a conversation', !!ours);
  check('no horizontal overflow after retry', !(await overflow()));
  await shot('crud-retried');

  // 3. Switching loads the other conversation and back again.
  await openRail();
  const other = page.locator(`button[title]:not([aria-current="true"]):visible`).first();
  await other.click();
  await page.waitForTimeout(1200);
  check('switching changes the URL', conversationParam() !== ours);
  check('switching hides our question', (await bubbles(question)) === 0);
  check('switching loads the other conversation', (await page.locator('time').count()) > 0);
  await openRail();
  await page.locator(`button[title="${question}"]:visible`).first().click();
  await page.waitForTimeout(1200);
  check('switching back restores the URL', conversationParam() === ours);
  check('switching back shows the question once', (await bubbles(question)) === 1);

  // 4. Deleting the open conversation, after confirming.
  await openRail();
  await page.getByRole('button', { name: `会话操作：${question}` }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const confirm = page.getByRole('dialog', { name: '删除这个会话？' });
  await confirm.waitFor();
  await page.waitForTimeout(600);
  check('row menu closes behind the confirmation', !(await page.getByRole('menuitem', { name: '删除' }).isVisible().catch(() => false)));
  check('focus moves into the confirmation', await confirm.evaluate((d) => d.contains(document.activeElement)));
  await shot('crud-delete-confirm');
  await confirm.getByRole('button', { name: /^删\s?除$/ }).click();
  await page.waitForTimeout(1500);
  check('confirmation closes', !(await confirm.isVisible().catch(() => false)));
  check('deleted row is gone', (await page.locator(`button[title="${question}"]`).count()) === 0);
  check('URL drops the deleted conversation', conversationParam() === null, conversationParam());
  const focus = await active();
  check('focus moves to 新建会话', focus.includes('新建会话'), focus);
  check('no horizontal overflow after delete', !(await overflow()));
  await shot('crud-deleted');
});
