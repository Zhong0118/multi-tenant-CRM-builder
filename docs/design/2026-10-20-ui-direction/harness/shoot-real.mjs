// Screenshots the real product's key pages for one role and width.
//   node shoot-real.mjs <outDir> <role> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3300';
const T = '/workspace/nebula-demo';
const width = Number(widthArg);
const height = width <= 390 ? 844 : 900;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768,
  storageState: `/tmp/ui-env/state-${role}.json`,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
const shot = async (label) => { await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }); await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` }); };
const go = async (path) => { await page.goto(`${WEB}${T}${path}`, { waitUntil: 'networkidle' }); };

await go(''); await shot('home');
await go('/objects/customers'); await shot('customers');
const firstLink = page.locator('main a[href*="/objects/customers/"]:visible').first();
if (await firstLink.count()) {
  await firstLink.click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 }).catch(() => {});
  await shot('customer-drawer');
}
if (role === 'admin') {
  await go('/settings/objects'); await shot('settings-objects');
  const objLink = page.locator('main a[href*="/settings/objects/"]:visible').first();
  if (await objLink.count()) { await objLink.click(); await page.waitForLoadState('networkidle'); await shot('object-config'); }
  await go('/members'); await shot('members');
}
await go('/ai'); await shot('ai');
console.log(`${role} ${width}: done; page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
