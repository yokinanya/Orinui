import { expect, test, type Page } from '@playwright/test';

// 全部为普通网页预览（vite preview），不代表真实扩展、真实书签 API 或扩展权限验收。
const DESKTOP = { width: 1440, height: 1000 };
const DRAG_STEPS = 12;
const DEFAULT_ORDER = ['clock', 'search', 'shortcuts', 'bookmarks'];

async function openHome(page: Page) {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  await expect(page.getByRole('main')).toBeVisible();
}

async function openLayoutPanel(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  return page.getByRole('tabpanel', { name: '布局', exact: true });
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
}

function renderedRegions(page: Page) {
  return page.locator('[data-layout-region]');
}

async function regionOrder(page: Page) {
  return renderedRegions(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-layout-region')));
}

/** 设置里的持久化顺序；用于证明显隐不会顺带重排。 */
async function settingsOrder(page: Page) {
  return page.locator('ol.settings-slot-list > li').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-layout-slot')));
}

test('设置方向键重排区域后主页按顺序渲染，刷新保持', async ({ page }) => {
  await openHome(page);
  // 书签区域没有注入内容节点时不渲染，但顺序中仍占一位。
  expect(await regionOrder(page)).toEqual(['clock', 'search', 'shortcuts']);

  const layout = await openLayoutPanel(page);
  expect(await settingsOrder(page)).toEqual(DEFAULT_ORDER);
  const handle = layout.getByRole('button', { name: '拖动搜索排序，方向键调整位置', exact: true });
  await handle.focus();
  await handle.press('ArrowDown');
  await expect.poll(() => settingsOrder(page)).toEqual(['clock', 'shortcuts', 'search', 'bookmarks']);
  await expect(layout.getByRole('button', { name: '上移搜索', exact: true })).toBeEnabled();
  await expect(layout.getByRole('button', { name: '下移搜索', exact: true })).toBeEnabled();
  await closeSettings(page);

  await expect.poll(() => regionOrder(page)).toEqual(['clock', 'shortcuts', 'search']);
  await page.reload();
  await expect.poll(() => regionOrder(page)).toEqual(['clock', 'shortcuts', 'search']);
});

test('显隐开关只隐藏区域，不改变持久化顺序，书签区域独立', async ({ page }) => {
  await openHome(page);
  const layout = await openLayoutPanel(page);
  await layout.getByRole('switch', { name: '显示搜索', exact: true }).click();
  await closeSettings(page);
  await expect(page.getByRole('search')).toHaveCount(0);
  expect(await regionOrder(page)).toEqual(['clock', 'shortcuts']);

  await openLayoutPanel(page);
  await expect(await settingsOrder(page)).toEqual(DEFAULT_ORDER);
  // 书签区域可单独隐藏，且隐藏不改动顺序。
  await expect(layout.getByRole('switch', { name: '显示浏览器收藏夹', exact: true })).toBeVisible();
  await layout.getByRole('switch', { name: '显示浏览器收藏夹', exact: true }).click();
  await expect.poll(() => settingsOrder(page)).toEqual(DEFAULT_ORDER);
  await layout.getByRole('switch', { name: '显示搜索', exact: true }).click();
  await closeSettings(page);
  await expect.poll(() => regionOrder(page)).toEqual(['clock', 'search', 'shortcuts']);
});

test('所有可见区域隐藏后给出恢复入口（书签未注入时不算可见）', async ({ page }) => {
  await openHome(page);
  const layout = await openLayoutPanel(page);
  for (const name of ['显示时钟', '显示搜索', '显示主页内容', '显示浏览器收藏夹']) {
    await layout.getByRole('switch', { name, exact: true }).click();
  }
  await closeSettings(page);
  await expect(page.getByText('主页内容已隐藏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复主页内容', exact: true }).click();
  await expect(page.locator('time')).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
});

test('设置拖动区域手柄重排与方向键结果一致', async ({ page }) => {
  await openHome(page);
  const layout = await openLayoutPanel(page);
  const handle = layout.getByRole('button', { name: '拖动时钟排序，方向键调整位置', exact: true });
  const source = await handle.boundingBox();
  const target = await layout.locator('ol.settings-slot-list > li[data-layout-slot="shortcuts"]').boundingBox();
  if (!source || !target) throw new Error('区域手柄或目标行未显示');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, source.y + 12, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: DRAG_STEPS });
  await page.mouse.up();

  await expect.poll(() => settingsOrder(page)).toEqual(['search', 'shortcuts', 'clock', 'bookmarks']);
  await closeSettings(page);
  await expect.poll(() => regionOrder(page)).toEqual(['search', 'shortcuts', 'clock']);
});

test('窄屏编辑模式显示区域手柄但不产生横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect(page.getByRole('button', { name: '拖动时钟排序', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('主页编辑模式拖动区域手柄重排并持久化，且不拦截搜索输入', async ({ page }) => {
  await openHome(page);
  await expect(page.getByRole('button', { name: '拖动时钟排序', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  const handle = page.getByRole('button', { name: '拖动时钟排序', exact: true });
  await expect(handle).toBeVisible();

  // 手柄之外的可交互内容保持自身行为：点击搜索输入仍直接聚焦。
  const input = page.getByRole('search').getByRole('textbox', { name: '搜索' });
  await input.click();
  await expect(input).toBeFocused();

  const source = await handle.boundingBox();
  const target = await page.locator('[data-layout-region="shortcuts"]').boundingBox();
  if (!source || !target) throw new Error('区域手柄或目标区域未显示');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, source.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: DRAG_STEPS });
  await page.mouse.up();

  await expect.poll(() => regionOrder(page)).toEqual(['search', 'shortcuts', 'clock']);
  await page.reload();
  await expect.poll(() => regionOrder(page)).toEqual(['search', 'shortcuts', 'clock']);

  await openLayoutPanel(page);
  expect(await settingsOrder(page)).toEqual(['search', 'shortcuts', 'clock', 'bookmarks']);
});
