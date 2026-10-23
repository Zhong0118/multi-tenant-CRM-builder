// node shoot-designer.mjs <width> <outDir> [fieldLabelToSelect]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const [widthArg, out, select] = process.argv.slice(2);
const width = Number(widthArg);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, storageState: '/tmp/ui-env/state-admin.json' });
const page = await context.newPage();
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
await page.goto('http://localhost:3300/workspace/nebula-demo/settings/objects', { waitUntil: 'networkidle' });
await page.locator('main').getByRole('link', { name: '客户', exact: true }).first().click();
await page.waitForLoadState('networkidle');
await page.getByRole('list', { name: '字段清单' }).waitFor();
if (select) await page.getByRole('button', { name: new RegExp(`^${select}`) }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/designer-${width}${select ? '-' + select : ''}.png` });
await browser.close();
