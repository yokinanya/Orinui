import { expect, test, type Locator, type Page } from '@playwright/test';

import { addHomeWidget, openAddMenu } from './form-helpers';

const DESKTOP = { width: 1440, height: 1200 };
const DRAG_STEPS = 12;
const HANDLE_LOCATOR = ':scope > [data-home-resize]';

async function expectPosition(item: Locator, position: { row: number; column: number; height: number }) {
  await expect(item).toHaveAttribute('data-home-row', String(position.row - 1));
  await expect(item).toHaveAttribute('data-home-column', String(position.column - 1));
  await expect(item).toHaveAttribute('data-home-height', String(position.height));
}

/** 整张卡片即拖拽手柄：从卡片底部留白按下，拖到目标格位中心。 */
async function dragToCell(page: Page, item: Locator, cell: Locator) {
  const box = await item.boundingBox();
  const target = await cell.boundingBox();
  if (!box || !target) throw new Error('条目或目标格位未显示');
  const start = { x: box.x + box.width / 2, y: box.y + box.height - 10 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: DRAG_STEPS });
  await page.mouse.up();
}

/** 拖右下角手柄上下移动，按行高换算目标高度。 */
async function dragResize(page: Page, item: Locator, rows: number) {
  const handle = item.locator(HANDLE_LOCATOR);
  const box = await handle.boundingBox();
  if (!box) throw new Error('调高手柄未显示');
  const rowHeight = await page.locator('[data-home-grid]').evaluate((element) => Number.parseFloat(getComputedStyle(element).gridAutoRows));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + rowHeight * rows, { steps: DRAG_STEPS });
  await page.mouse.up();
}

async function addWidget(page: Page, kind: '便签' | '待办') {
  await addHomeWidget(page, kind);
}

test('Niagara 双列小组件、纯文本、空位、重载和待办操作', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  page.on('pageerror', (error) => { throw new Error(`页面报错：${error.message}`); });
  const requests: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:5173')) requests.push(request.url()); });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await openAddMenu(page, '添加便签');
  const note = page.getByRole('region', { name: '便签', exact: true });
  await note.getByLabel('便签内容').fill('<b>纯文本</b>\n第二行');
  await openAddMenu(page, '添加待办');
  const todo = page.getByRole('region', { name: '待办', exact: true });
  await todo.getByLabel('新待办', { exact: true }).fill('测试待办');
  await todo.getByRole('button', { name: '添加', exact: true }).click();
  await todo.getByRole('checkbox', { name: '完成 测试待办' }).click();
  await expect(todo.getByRole('checkbox', { name: '完成 测试待办' })).toBeChecked();
  const grid = page.locator('[data-home-grid]');
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '));
  expect(columns).toHaveLength(2);
  const noteItem = page.locator('[data-home-item]').filter({ has: note });
  await dragToCell(page, noteItem, page.locator('[data-home-cell="3:0"]'));
  await expect(noteItem).toHaveCSS('grid-row-start', '4');
  await page.reload();
  await expect(page.getByLabel('便签内容')).toHaveValue('<b>纯文本</b>\n第二行');
  await expect(page.getByRole('checkbox', { name: '完成 测试待办' })).toBeChecked();
  await expect(page.locator('[data-home-item]').filter({ has: page.getByRole('region', { name: '便签', exact: true }) }))
    .toHaveCSS('grid-row-start', '4');
  expect(requests).toEqual([]);
});

test('小组件真实手柄跨列拖动、连锁下推与另一列不变，刷新保留', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await addWidget(page, '便签');
  await addWidget(page, '待办');
  await addWidget(page, '待办');
  await addWidget(page, '待办');
  const note = page.locator('[data-home-item]').filter({ has: page.getByRole('region', { name: '便签', exact: true }) });
  const todos = page.locator('[data-home-item]').filter({ has: page.getByRole('region', { name: '待办', exact: true }) });
  const ids = await todos.evaluateAll((items) => items.map((item) => item.getAttribute('data-home-item')));
  const other = page.locator(`[data-home-item="${ids[1]}"]`);
  const upper = page.locator(`[data-home-item="${ids[0]}"]`);
  const lower = page.locator(`[data-home-item="${ids[2]}"]`);
  // 便签在失焦时保存：先填写，再进行会移动焦点的拖拽。
  await note.getByLabel('便签内容').fill('拖动后保留内容');
  await page.keyboard.press('Tab');
  await dragToCell(page, note, page.locator('[data-home-cell="1:1"]'));
  // 便签容器用 isRole=region 定位，拖动抓手只属于该条目。
  const positions = [
    { item: note, row: 2, column: 2, height: 3 },
    { item: upper, row: 5, column: 2, height: 3 },
    { item: lower, row: 8, column: 2, height: 3 },
    { item: other, row: 4, column: 1, height: 3 },
  ];
  for (const { item, ...position } of positions) await expectPosition(item, position);
  await page.reload();
  for (const { item, ...position } of positions) await expectPosition(item, position);
  await expect(note.getByLabel('便签内容')).toHaveValue('拖动后保留内容');
});

test('右下角手柄拖动调高、待在编辑模式且刷新持久化', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await addWidget(page, '便签');
  await addWidget(page, '待办');
  const note = page.locator('[data-home-item]').filter({ has: page.getByRole('region', { name: '便签', exact: true }) });
  const todo = page.locator('[data-home-item]').filter({ hasText: '待办' });
  // 只剩右下角调高手柄，不再有左下角抓手与高度按钮。
  await expect(note.locator('[data-home-tools]')).toHaveCount(0);
  await expect(note.locator(HANDLE_LOCATOR)).toBeVisible();
  await expect(page.getByRole('button', { name: /高度 \d 行/u })).toHaveCount(0);
  await dragResize(page, note, 2);
  await expect(note).toHaveAttribute('data-home-height', '4');
  // 仍在编辑模式：工具栏可见，且条目保留拖拽属性。
  await expect(page.getByRole('button', { name: '完成编辑', exact: true })).toBeVisible();
  await expect(note).toHaveAttribute('aria-roledescription', 'draggable');
  await page.reload();
  await expectPosition(note, { row: 1, column: 1, height: 4 });
  await expectPosition(todo, { row: 1, column: 2, height: 3 });
  await todo.getByLabel('新待办', { exact: true }).fill('键盘完成');
  await todo.getByLabel('新待办', { exact: true }).press('Enter');
  const checkbox = todo.getByRole('checkbox', { name: '完成 键盘完成' });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.reload();
  await expectPosition(note, { row: 1, column: 1, height: 4 });
  await expectPosition(todo, { row: 1, column: 2, height: 3 });
  // 勾选状态经小组件自动保存落库，刷新后仍在。
  await expect(page.getByRole('checkbox', { name: '完成 键盘完成' })).toBeChecked();
});
