// Conversation create / retry / switch / delete against the local mock provider.
//   node ai-crud.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

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
const log = (...a) => console.log(...a);
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
const railRows = (text) => page.locator(`button[title="${text}"]`).count();

await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 1. 新建会话 starts an empty conversation.
await openRail();
await page.getByRole('button', { name: /新建会话/ }).click();
await page.waitForTimeout(600);
log('new: conversation param', conversationParam(), 'composer empty', (await composer().inputValue()) === '',
  'bubbles', await page.locator('time').count());

// 2. A failed turn offers 重试; retrying answers without repeating the question.
const question = `这次一次失败的复盘 ${Date.now() % 100000}`;
await composer().fill(question);
await composer().press('Enter');
const retry = page.getByRole('button', { name: /^重\s?试$/ }).last();
await retry.waitFor({ timeout: 60000 }).catch(async (e) => { await shot('crud-debug'); log('no retry', e.message.split('\n')[0]); });
log('failed: retry offered', await retry.isVisible(), 'composer cleared', (await composer().inputValue()) === '');
await shot('crud-failed');
await retry.click();
await page.getByText('回答已完成').waitFor({ state: 'attached', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
const ours = conversationParam();
log('retried: answer shown', await page.getByText('回答已完成').count() > 0,
  'question bubbles', await bubbles(question), 'rail rows', await railRows(question),
  'retry gone', !(await retry.isVisible().catch(() => false)), 'conversation', !!ours, 'overflowX', await overflow());
await shot('crud-retried');

// 3. Switching loads the other conversation and back again.
await openRail();
const other = page.locator(`button[title]:not([aria-current="true"]):visible`).first();
const otherTitle = await other.getAttribute('title');
await other.click();
await page.waitForTimeout(1200);
log('switch: url changed', conversationParam() !== ours, 'own question hidden', await bubbles(question) === 0,
  'other loaded', await page.locator('time').count() > 0, 'other', otherTitle);
await openRail();
await page.locator(`button[title="${question}"]:visible`).first().click();
await page.waitForTimeout(1200);
log('switch back: url', conversationParam() === ours, 'question bubbles', await bubbles(question));

// 4. Deleting the open conversation, after confirming.
await openRail();
await page.getByRole('button', { name: `会话操作：${question}` }).click();
await page.getByRole('menuitem', { name: '删除' }).click();
const confirm = page.getByRole('dialog', { name: '删除这个会话？' });
await confirm.waitFor();
await page.waitForTimeout(600);
log('delete confirm: menu closed', !(await page.getByRole('menuitem', { name: '删除' }).isVisible().catch(() => false)),
  'focus inside', await confirm.evaluate((d) => d.contains(document.activeElement)));
await shot('crud-delete-confirm');
await confirm.getByRole('button', { name: /^删\s?除$/ }).click();
await page.waitForTimeout(1500);
log('deleted: dialog gone', !(await confirm.isVisible().catch(() => false)),
  'row gone', await page.locator(`button[title="${question}"]`).count() === 0,
  'url conversation', conversationParam(), 'focus', await active(), 'overflowX', await overflow());
await shot('crud-deleted');
await browser.close();
