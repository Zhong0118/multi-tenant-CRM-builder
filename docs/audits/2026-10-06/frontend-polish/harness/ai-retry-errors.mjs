// Retrying a persisted failure must show this attempt's error, not the stored
// row's. The retry endpoint is intercepted to simulate a permission change,
// a dropped connection and a stream cut off mid-answer. Exits 1 on failure.
//   node ai-retry-errors.mjs <outDir> <role> <width>
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
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
const composer = () => page.locator('textarea').first();
const retryButtons = () => page.getByRole('button', { name: /^重\s?试$/ });
const count = (text) => page.getByText(text).count();
const PROVIDER = 'AI 服务暂时不可用，请稍后重试';
const FORBIDDEN = '你的访问权限发生变化，请重新提问';
const NETWORK = '连接已中断';
const RETRY = '**/ai/turns/*/retry';
const cors = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' };
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const turnIdOf = (url) => decodeURIComponent(url.split('/turns/')[1].split('/')[0]);

// Only the POST is replaced; a CORS preflight still reaches the API.
async function interceptRetry(handler) {
  await page.unroute(RETRY);
  await page.route(RETRY, (route) => (route.request().method() === 'POST' ? handler(route) : route.continue()));
}
async function reloadPersistedFailure(check, label) {
  await page.reload({ waitUntil: 'networkidle' });
  await retryButtons().first().waitFor({ timeout: 15000 });
  check(`${label}: reload shows the stored failure once`, (await count(PROVIDER)) === 1);
}

await run(`ai-retry-errors ${role} ${width}`, browser, async (check) => {
  await page.goto(`${WEB}/workspace/nebula-demo/ai`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const question = `这次请求会失败 ${Date.now() % 100000}`;
  await composer().fill(question);
  await composer().press('Enter');
  await retryButtons().first().waitFor({ timeout: 60000 });
  check('provider failure is stored with 重试', (await count(PROVIDER)) === 1);

  // 1. Permission revoked between the failure and the retry.
  await reloadPersistedFailure(check, 'forbidden');
  await interceptRetry((route) => route.fulfill({
    status: 403, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ status: 403, code: 'WORKSPACE_FORBIDDEN', message: '无权访问该工作区', requestId: 'req-polish-retry-403' }),
  }));
  await retryButtons().first().click();
  await page.getByText(FORBIDDEN).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  check('403 retry shows the permission change', (await count(FORBIDDEN)) === 1, await count(FORBIDDEN));
  check('403 retry hides the stored provider error', (await count(PROVIDER)) === 0, await count(PROVIDER));
  check('403 retry keeps the question', (await count(question)) > 0);
  await shot('retry-forbidden');

  // 2. The connection drops before the retry answers.
  await reloadPersistedFailure(check, 'network');
  await interceptRetry((route) => route.abort('failed'));
  await retryButtons().first().click();
  await page.getByText(NETWORK).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  check('dropped retry shows 连接已中断', (await count(NETWORK)) === 1, await count(NETWORK));
  check('dropped retry hides the stored provider error', (await count(PROVIDER)) === 0, await count(PROVIDER));
  check('dropped retry offers 重试 once', (await retryButtons().count()) === 1, await retryButtons().count());
  await shot('retry-network');

  // 3. The retry stream starts answering, then closes without finishing.
  await reloadPersistedFailure(check, 'truncated');
  await interceptRetry((route) => {
    const turnId = turnIdOf(route.request().url());
    return route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'text/event-stream' },
      body: sse('turn.started', { turnId }) + sse('assistant.delta', { text: '先看华东物流的回款，' }),
    });
  });
  await retryButtons().first().click();
  await page.getByText(NETWORK).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  check('cut-off retry keeps the partial answer', (await count('先看华东物流的回款')) === 1);
  check('cut-off retry shows 连接已中断', (await count(NETWORK)) === 1, await count(NETWORK));
  check('cut-off retry hides the stored provider error', (await count(PROVIDER)) === 0);
  check('cut-off retry leaves the composer usable', await page.getByRole('button', { name: /发\s?送/ }).isVisible());
  await shot('retry-truncated');

  // 4. A real retry rewrites the stored row; its error shows exactly once.
  await page.unroute(RETRY);
  await reloadPersistedFailure(check, 'real');
  await retryButtons().first().click();
  await retryButtons().first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await retryButtons().first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  check('real retry failure shows the provider error once', (await count(PROVIDER)) === 1, await count(PROVIDER));
  check('real retry shows no stale transport error', (await count(NETWORK)) + (await count(FORBIDDEN)) === 0);
  await shot('retry-real');
});
