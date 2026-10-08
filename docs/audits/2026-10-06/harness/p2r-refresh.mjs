// P2-R: a save that lands after the member cancelled and started a new edit
// must not discard the new draft when the server refresh brings a newer
// version. The first PATCH is held, then released after the new draft is
// typed; the real API commits it and the real router.refresh() re-renders.
// Exits 1 if any check fails.
//
// Needs playwright-core and Chrome, the local Web on 3200 against an isolated
// database, and saved logged-in storage states (no credentials in this file):
//   STATE_DIR=<dir with state-admin.json/state-employee.json> \
//     node p2r-refresh.mjs <outDir> <admin|employee> <width>
import fs from 'node:fs';
import { chromium } from 'playwright-core';

// Every result goes through check(); a failed check or a thrown error makes the
// process exit 1, so a run that exits 0 means every check passed.
async function run(label, browser, flow) {
  const failures = [];
  let total = 0;
  const check = (name, ok, detail) => {
    total += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    if (!ok) failures.push(name);
  };
  try {
    await flow(check);
  } catch (error) {
    check('flow completed without error', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    await browser.close();
    if (failures.length) {
      console.error(`${label}: ${failures.length}/${total} checks failed: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(`${label}: all ${total} checks passed`);
    }
  }
}

const [outDir, role, widthArg] = process.argv.slice(2);
const WEB = 'http://localhost:3200';
const T = '/workspace/nebula-demo';
const width = Number(widthArg);
const height = width <= 390 ? 844 : 900;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768,
  storageState: `${process.env.STATE_DIR ?? '/tmp/crm-polish'}/state-${role}.json`,
});
const page = await context.newPage();
const shot = (label) => page.screenshot({ path: `${outDir}/${role}-${width}-${label}.png` });
const RECORD_PATCH = /\/records\/[^/?]+$/;

await run(`p2r-refresh ${role} ${width}`, browser, async (check) => {
  await page.goto(`${WEB}${T}/objects/customers?search=${encodeURIComponent('赵晨')}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: '客户 赵晨-1' }).first().click();
  const drawer = page.getByRole('dialog').first();
  await drawer.waitFor();
  await page.waitForTimeout(500);
  const recordUrl = page.url();
  const recordId = new URL(recordUrl).pathname.split('/').at(-1);
  const serverVersion = async () => {
    const response = await context.request.get(`http://localhost:3201/api/v1/workspaces/nebula-demo/objects/customers/records/${recordId}`);
    if (!response.ok()) throw new Error(`Record read failed: ${response.status()}`);
    return (await response.json()).version;
  };
  const startVersion = await serverVersion();
  check('server supplies the starting version', Number.isInteger(startVersion), startVersion);

  const edit = () => page.getByRole('button', { name: /^编\s*辑$/ }).click();
  const note = () => page.getByRole('textbox', { name: '客户备注', exact: true });
  const saveButton = () => page.getByRole('button', { name: '保存修改' });
  await edit();
  // A previous interrupted run may have left its marker behind.
  const original = (await note().inputValue()).replace(/（旧保存）|（新草稿）/g, '');
  const stale = `${original}（旧保存）`;
  const draft = `${original}（新草稿）`;

  // 1. Hold the first save in flight.
  let releaseFirst;
  const held = new Promise((resolve) => {
    page.route(RECORD_PATCH, (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      resolve();
      releaseFirst = () => route.continue();
    });
  });
  await note().fill(stale);
  await saveButton().click();
  await held;
  check('first save is in flight', !!releaseFirst);

  // 2. Cancel, edit again and type a different draft.
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await edit();
  await note().fill(draft);
  check('new draft is typed', (await note().inputValue()) === draft);

  // 3. Release the first save; wait for its commit and the RSC refresh.
  const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && RECORD_PATCH.test(new URL(r.url()).pathname));
  const refreshed = page.waitForResponse((r) => r.request().headers()['rsc'] === '1' && new URL(r.url()).pathname === new URL(recordUrl).pathname, { timeout: 15000 });
  await releaseFirst();
  await page.unroute(RECORD_PATCH);
  const committed = await (await patched).json();
  check('first save commits on the server', committed.version === startVersion + 1, committed.version);
  const rsc = await refreshed;
  check('server refresh succeeds', rsc.ok(), rsc.status());
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await shot('p2r-after-refresh');
  check('URL stays on the record', page.url() === recordUrl, page.url());
  check('edit session stays open after the refresh', await saveButton().isVisible());
  check('new draft survives the refresh', (await note().inputValue()) === draft, await note().inputValue());

  // 4. The draft was started from the older version; saving it is a conflict.
  await saveButton().click();
  const conflict = drawer.getByRole('button', { name: '重新载入记录' });
  await conflict.waitFor({ timeout: 10000 });
  check('saving the draft reports the version conflict', await conflict.isVisible());
  check('conflict keeps the draft', (await note().inputValue()) === draft);
  await shot('p2r-conflict');

  // 5. Leaving the draft shows the committed result at the newer version.
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.waitForTimeout(500);
  check('reading view shows the committed save', (await drawer.getByText(stale, { exact: true }).count()) > 0);
  check('server keeps the committed version after the rejected stale save', (await serverVersion()) === startVersion + 1);

  // Restore the fixture value.
  await edit();
  await note().fill(original);
  await saveButton().click();
  await saveButton().waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(800);
  check('fixture value restored', (await drawer.getByText(original, { exact: true }).count()) > 0);
});
