// Business-table field designer, end to end against the real API and database: the list and the
// inline editor, saving, the unsaved-edit guards, keyboard reorder, and the preview button.
// Restores everything it changes. Does not publish. Exits 1 if any check fails.
//   node field-config.mjs <outDir> [width]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { run } from './check.mjs';

const [outDir, widthArg] = process.argv.slice(2);
const width = Number(widthArg ?? 1440);
const WEB = 'http://localhost:3300';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, storageState: '/tmp/ui-env/state-admin.json' });
const page = await context.newPage();
await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }); });
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const row = (label) => page.getByRole('button', { name: new RegExp(`^${label}`) });
const panel = (label) => page.getByRole('region', { name: `配置字段：${label}` });
const nameInput = () => page.getByRole('textbox', { name: '字段名称' });
const rowLabels = () => page.getByRole('list', { name: '字段清单' }).getByRole('listitem').evaluateAll((items) => items.map((li) => li.querySelector('button[aria-current], button:not([aria-label])')?.textContent?.slice(0, 4) ?? ''));
const saveButton = () => page.getByRole('button', { name: '保存字段' });
const isPatch = (r) => r.request().method() === 'PATCH' && /\/object-definitions\/[^/]+\/fields\/[^/]+$/.test(new URL(r.url()).pathname);
const isReorder = (r) => /\/object-definitions\/[^/]+\/field-order$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT';

await run(`field-config ${width}`, browser, async (check) => {
  await page.goto(`${WEB}/workspace/nebula-demo/settings/objects`, { waitUntil: 'networkidle' });
  await page.locator('main').getByRole('link', { name: '客户', exact: true }).first().click();
  await page.waitForLoadState('networkidle');
  const list = page.getByRole('list', { name: '字段清单' });
  const items = list.getByRole('listitem');
  await list.waitFor();
  const designerUrl = page.url();

  // An interrupted earlier run may have left its trial name or order behind; put them back first.
  const leftover = page.getByRole('button', { name: /^联系电话（主/ });
  if (await leftover.count()) {
    await leftover.click();
    await nameInput().fill('联系电话');
    const cleaned = page.waitForResponse(isPatch, { timeout: 15000 });
    await saveButton().click();
    await cleaned;
    await panel('联系电话').waitFor();
  }
  for (let guard = 0; guard < 6; guard += 1) {
    const first = (await items.first().textContent()) ?? '';
    if (first.startsWith('客户名称')) break;
    const handle = page.getByRole('button', { name: '拖动调整 客户名称' });
    await handle.focus();
    const moved = page.waitForResponse(isReorder, { timeout: 15000 });
    await page.keyboard.press('ArrowUp');
    await moved;
    await page.waitForTimeout(400);
  }
  await page.goto(designerUrl, { waitUntil: 'networkidle' });
  await list.waitFor();

  // 1. List and default selection.
  const count = await items.count();
  check('the list shows every field', count >= 5, count);
  const firstText = (await items.first().textContent()) ?? '';
  check('a row carries label, key, type and access', /客户名称/.test(firstText) && /name/.test(firstText) && /文本/.test(firstText) && /员工可编辑/.test(firstText), firstText);
  check('the first row is flagged 记录名称 and 必填', /记录名称/.test(firstText) && /必填/.test(firstText));
  check('the first field is open in the editor', await panel('客户名称').isVisible());
  check('exactly one row is marked as current', (await list.locator('[aria-current="true"]').count()) === 1);
  check('field names are not squeezed to one character per line', (await list.locator('li').first().evaluate((li) => li.getBoundingClientRect().height)) < 90);
  check('the employee preview is not on the page until asked for', (await page.getByRole('region', { name: '权限预览' }).count()) === 0);
  await shot('designer-default');

  // 2. Choosing another field opens its saved configuration.
  await row('联系电话').click();
  await panel('联系电话').waitFor();
  const original = await nameInput().inputValue();
  check('choosing a row opens that field', original === '联系电话', original);
  check('a published field keeps its key locked', await page.getByRole('textbox', { name: '字段键' }).isDisabled());
  check('a published field keeps its type locked', await page.getByLabel('数据类型').isDisabled());
  check('nothing to save yet', await saveButton().isDisabled());

  // 3. Unsaved edits are tracked, and guarded.
  await nameInput().fill('联系电话（主）');
  check('an edit shows 有未保存的修改', await page.getByText('有未保存的修改').isVisible());
  check('publishing is held back while edits are unsaved', await page.getByRole('button', { name: '发布变更' }).isDisabled());
  await row('客户等级').click();
  const dialog = page.getByRole('dialog', { name: '放弃未保存的修改？' });
  await dialog.waitFor();
  check('another row asks before discarding edits', await dialog.isVisible());
  await page.waitForTimeout(400);
  await shot('discard-dialog');
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await dialog.waitFor({ state: 'hidden' });
  check('继续编辑 keeps the field and its edits', (await nameInput().inputValue()) === '联系电话（主）' && (await panel('联系电话').isVisible()));
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await dialog.waitFor();
  check('leaving the fields step asks as well', await dialog.isVisible());
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await dialog.waitFor({ state: 'hidden' });
  check('and stays on the fields step', await page.getByText('正在编辑：字段').isVisible());

  // 4. Save: written to the draft, still on the field, editor restarted from what was saved.
  const patched = page.waitForResponse(isPatch, { timeout: 15000 });
  await saveButton().click();
  const saved = await patched;
  check('saving the field succeeds', saved.ok(), saved.status());
  await panel('联系电话（主）').waitFor();
  check('the editor stays on the saved field with its new name', (await nameInput().inputValue()) === '联系电话（主）');
  check('it reports 字段已保存 beside the buttons', await page.locator('strong', { hasText: '字段已保存' }).isVisible());
  check('and does not add a banner that would push the editor down', (await page.locator('.ant-alert-success').count()) === 0);
  check('the list row shows the new name', (await items.nth(1).textContent())?.includes('联系电话（主）') ?? false);
  check('nothing is left to save and publishing is available again', (await saveButton().isDisabled()) && (await page.getByRole('button', { name: '发布变更' }).isEnabled()));
  await shot('after-save');

  // 5. It persisted in the draft.
  await page.goto(designerUrl, { waitUntil: 'networkidle' });
  await page.getByRole('list', { name: '字段清单' }).waitFor();
  check('the new name is still there after a reload', ((await items.nth(1).textContent()) ?? '').includes('联系电话（主）'));

  // 6. Keyboard reorder keeps focus and unsaved edits.
  await row('联系电话（主）').click();
  await nameInput().fill('联系电话（主）试改');
  const orderBefore = await rowLabels();
  const handle = page.getByRole('button', { name: '拖动调整 联系电话（主）' });
  await handle.focus();
  const reordered = page.waitForResponse(isReorder, { timeout: 15000 });
  await page.keyboard.press('ArrowUp');
  check('ArrowUp saves a new field order', (await reordered).ok());
  await page.waitForFunction(() => document.querySelector('ul[aria-label="字段清单"] li:first-child')?.textContent?.includes('联系电话'), null, { timeout: 10000 });
  check('the moved field is first', ((await items.first().textContent()) ?? '').includes('联系电话（主）'), await rowLabels());
  check('keyboard focus is back on the moved handle', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '拖动调整 联系电话（主）'), await page.evaluate(() => document.activeElement?.getAttribute('aria-label')));
  check('the edit survived the reorder', (await nameInput().inputValue()) === '联系电话（主）试改');
  check('the editor is still on the same field', await panel('联系电话（主）').isVisible());
  const reorderedBack = page.waitForResponse(isReorder, { timeout: 15000 });
  await page.keyboard.press('ArrowDown');
  check('ArrowDown moves it back', (await reorderedBack).ok());
  await page.waitForFunction(() => document.querySelector('ul[aria-label="字段清单"] li:nth-child(2)')?.textContent?.includes('联系电话'), null, { timeout: 10000 });
  check('the original order is restored', JSON.stringify(await rowLabels()) === JSON.stringify(orderBefore), await rowLabels());

  // 7. Restore the field name (this saves the typed value over the trial edit).
  await nameInput().fill('联系电话');
  const restored = page.waitForResponse(isPatch, { timeout: 15000 });
  await saveButton().click();
  check('the original name is saved back', (await restored).ok());
  await panel('联系电话').waitFor();

  // 8. The preview is behind the button and can be closed.
  await page.getByRole('button', { name: '打开员工端预览' }).click();
  const preview = page.getByRole('dialog', { name: '员工端预览' });
  await preview.waitFor();
  check('the preview opens as a drawer with the permission preview', await preview.getByRole('region', { name: '权限预览' }).isVisible());
  await page.waitForTimeout(500);
  await shot('preview-drawer');
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'hidden' });
  check('Escape closes the preview', true);
  check('opening the preview left the editor alone', await panel('联系电话').isVisible());
});
