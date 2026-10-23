// node shoot-drawer.mjs <role> <width> <out.png> [scrollTo]
import { chromium } from 'playwright-core';
const [role, widthArg, out, scrollArg] = process.argv.slice(2);
const width = Number(widthArg);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, storageState: `/tmp/ui-env/state-${role}.json` });
const page = await context.newPage();
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
await page.goto('http://localhost:3300/workspace/nebula-demo/objects/customers?search=' + encodeURIComponent('赵晨'), { waitUntil: 'networkidle' });
await page.getByRole('link', { name: '客户 赵晨-1' }).first().click();
const drawer = page.getByRole('dialog').first();
await drawer.waitFor();
await page.waitForTimeout(900);
if (scrollArg) { await page.locator('.ant-drawer-body').evaluate((el, y) => { el.scrollTop = y; }, Number(scrollArg)); await page.waitForTimeout(300); }
await page.screenshot({ path: out });
await browser.close();
