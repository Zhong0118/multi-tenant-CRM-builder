// Drives the AI page against the local mock provider and captures states.
// Exits 1 if any check fails.
//   node ai-flow.mjs <outDir> <role> <width>
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
const composer = () => page.locator('textarea').first();
async function ask(text) {
  await composer().fill(text);
  await composer().press('Enter');
}
async function newConversation() {
  await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

await run(`ai-flow ${role} ${width}`, browser, async (check) => {
  // Screenshot plus the layout checks every state must pass.
  const shot = async (label) => {
    const m = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    await page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
    check(`${label}: no horizontal overflow`, !m.overflowX);
    check(`${label}: document does not scroll`, m.docScroll <= 1, m.docScroll);
  };

  await newConversation();
  await ask('请给我一份长的本周汇总');
  await page.getByText('华东物流').first().waitFor({ timeout: 30000 });
  await shot('ai-streaming');
  check('streaming shows 停止', await page.getByRole('button', { name: /停\s?止/ }).isVisible());
  await page.getByText('回答已完成').waitFor({ state: 'attached', timeout: 90000 });
  await page.waitForTimeout(1200);
  check('long answer renders its table', (await page.locator('main table').count()) === 1);
  check('long answer renders its code block', (await page.locator('main pre code').count()) === 1);
  check('long answer hides Markdown markers', !(await page.locator('main').textContent()).includes('```'));
  await shot('ai-long');

  // Escaped pipes stay in their cell; a row wider than its header is kept as text.
  await newConversation();
  await ask('给我一张表格');
  await page.getByText('回答已完成').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(800);
  const cells = await page.locator('main table td').allTextContents();
  check('escaped pipe stays inside its cell', cells.includes('¥1,200 | 含税'), cells);
  check('table keeps three columns', (await page.locator('main table th').count()) === 3);
  check('wider row is shown as written, not truncated',
    (await page.getByText('| 星河教育 | ¥800 | 未税 | 待确认 |').count()) === 1);
  await shot('ai-table');

  await newConversation();
  await ask('这次请求会失败');
  await page.getByRole('button', { name: /^重\s?试$/ }).waitFor({ timeout: 60000 });
  check('failed turn shows the provider error once', (await page.getByText('AI 服务暂时不可用，请稍后重试').count()) === 1);
  await shot('ai-failed');

  await newConversation();
  await ask('慢一点回答本周情况');
  await page.getByText('这里是').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /停\s?止/ }).click();
  await page.getByText('回答已停止').first().waitFor({ timeout: 10000 });
  check('stopped turn offers 重试', await page.getByRole('button', { name: /^重\s?试$/ }).isVisible());
  await shot('ai-stopped');

  if (width < 1200) {
    await page.getByRole('button', { name: /会\s?话/ }).click();
    await page.waitForTimeout(800);
    check('narrow rail opens as a drawer', await page.getByRole('dialog', { name: 'AI 会话' }).isVisible());
    await shot('ai-drawer');
  }
});
