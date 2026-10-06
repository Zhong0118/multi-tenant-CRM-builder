// Drives the AI page against the local mock provider and captures states.
//   node ai-flow.mjs <outDir> <role> <width>
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
const shot = async (label) => {
  const m = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  await page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
  console.log(label, JSON.stringify(m));
};
const composer = () => page.locator('textarea').first();
async function ask(text) {
  await composer().fill(text);
  await composer().press('Enter');
}
async function newConversation() {
  await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

await newConversation();
await ask('请给我一份长的本周汇总');
await page.waitForTimeout(2500);
await shot('ai-streaming');
await page.getByText('回答已完成').waitFor({ state: 'attached', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1200);
await shot('ai-long');

await newConversation();
await ask('这次请求会失败');
await page.waitForTimeout(12000);
await shot('ai-failed');

await newConversation();
await ask('慢一点回答本周情况');
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /停\s?止/ }).click().catch((e) => console.log('stop', e.message));
await page.waitForTimeout(1500);
await shot('ai-stopped');

if (width < 1200) {
  await page.getByRole('button', { name: /会\s?话/ }).click().catch((e) => console.log('drawer', e.message));
  await page.waitForTimeout(800);
  await shot('ai-drawer');
}
await browser.close();
