// node shoot-designer-section.mjs <section> <out.png> [width]
import { chromium } from 'playwright-core';
const [section, out, widthArg] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: Number(widthArg ?? 1440), height: 900 }, storageState: '/tmp/ui-env/state-admin.json' });
const page = await context.newPage();
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
await page.goto('http://localhost:3300/workspace/nebula-demo/settings/objects', { waitUntil: 'networkidle' });
await page.locator('main').getByRole('link', { name: '客户', exact: true }).first().click();
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: section, exact: true }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: out });
await browser.close();
