import { expect, test } from '@playwright/test';

async function openLayoutPanel(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  return page.getByRole('tabpanel', { name: '布局', exact: true });
}

async function closeSettings(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
}

test('顶部工作台将搜索居中、时钟放在所选角落并让网格紧随顶部区域', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'centered');

  const layout = await openLayoutPanel(page);
  await layout.getByRole('button', { name: '顶部工作台' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'top-search');
  await expect(page.locator('[data-layout-header="top-search"]')).toBeVisible();
  // 设置面板为模态，主页在关闭前不可见；先关闭，再检查主页几何。
  await closeSettings(page);
  await expect(page.locator('[data-layout-header="top-search"]')).toBeVisible();
  await expect(page.getByRole('region', { name: '快捷方式' })).toBeVisible();
  await expect.poll(() => page.locator('[data-layout-search]').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Math.abs(bounds.x + bounds.width / 2 - window.innerWidth / 2);
  })).toBeLessThan(2);
  const time = page.locator('[data-layout-clock-position] time');
  await expect.poll(() => time.evaluate((element) => element.getBoundingClientRect().left)).toBeLessThan(400);
  await expect.poll(() => time.evaluate((element) => {
    const slot = element.closest('[data-layout-clock-position]');
    if (!slot) throw new Error('缺少顶部时钟区域');
    return Math.abs(element.getBoundingClientRect().left - slot.getBoundingClientRect().left);
  })).toBeLessThan(2);
  await expect.poll(async () => {
    const header = await page.locator('[data-layout-header="top-search"]').boundingBox();
    const shortcuts = await page.getByRole('region', { name: '快捷方式' }).boundingBox();
    return header && shortcuts ? shortcuts.y > header.y + header.height : false;
  }).toBe(true);

  await openLayoutPanel(page);
  await layout.getByRole('button', { name: '右对齐' }).click();
  await closeSettings(page);
  await expect(page.locator('[data-layout-clock-position]')).toHaveAttribute('data-layout-clock-position', 'right');
  await expect.poll(() => time.evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThan(900);
  await expect.poll(() => time.evaluate((element) => {
    const slot = element.closest('[data-layout-clock-position]');
    if (!slot) throw new Error('缺少顶部时钟区域');
    return Math.abs(element.getBoundingClientRect().right - slot.getBoundingClientRect().right);
  })).toBeLessThan(2);
  await openLayoutPanel(page);
  const showClock = layout.getByRole('switch', { name: '显示时钟' });
  await showClock.click();
  await expect(page.getByRole('group', { name: '时钟对齐' }).locator('[data-slot="toggle-group-item"]').first()).toBeDisabled();
  await closeSettings(page);
  await expect(page.locator('[data-layout-clock-position]')).toHaveCount(0);
  await expect(page.locator('[data-layout-search]')).toHaveCount(1);
  await openLayoutPanel(page);
  await showClock.click();
  await expect(page.getByRole('group', { name: '时钟对齐' }).locator('[data-slot="toggle-group-item"]').first()).toBeEnabled();
  await expect(page.locator('[data-layout-clock-position]')).toHaveAttribute('data-layout-clock-position', 'right');
  await expect(layout.getByText(/仅“居中留白”支持调整区域顺序/)).toBeVisible();
  await expect(layout.getByRole('button', { name: /拖动时钟排序/ })).toBeDisabled();
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'top-search');
  await expect(page.locator('[data-layout-clock-position]')).toHaveAttribute('data-layout-clock-position', 'right');
});

test('顶部工作台的时钟贴齐页面两侧边缘，搜索框保持居中且不与时钟重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  const layout = await openLayoutPanel(page);
  await layout.getByRole('button', { name: '顶部工作台' }).click();
  await closeSettings(page);

  const time = page.locator('[data-layout-clock-position] time');
  const search = page.locator('[data-layout-search]');
  const container = page.locator('[data-layout-container]');
  await expect(search).toBeVisible();
  const leftGap = () => time.evaluate((element) => element.getBoundingClientRect().left);
  const rightGap = () => time.evaluate((element) => window.innerWidth - element.getBoundingClientRect().right);
  await expect.poll(leftGap).toBeLessThanOrEqual(24);
  expect(await rightGap()).toBeGreaterThan(400);

  await openLayoutPanel(page);
  await layout.getByRole('button', { name: '右对齐' }).click();
  await closeSettings(page);
  await expect.poll(rightGap).toBeLessThanOrEqual(24);
  expect(await leftGap()).toBeGreaterThan(400);

  // 时钟可以越过内容宽度约束，但必须停在搜索框外侧且不溢出视口。
  await expect.poll(() => page.evaluate(() => {
    const time = document.querySelector('[data-layout-clock-position] time')?.getBoundingClientRect();
    const search = document.querySelector('[data-layout-search]')?.getBoundingClientRect();
    const box = document.querySelector('[data-layout-container]')?.getBoundingClientRect();
    if (!time || !search || !box) throw new Error('缺少顶部工作台区域');
    return Math.abs((search.left + search.right) / 2 - window.innerWidth / 2) < 2 && search.right <= time.left;
  })).toBe(true);
  await expect.poll(() => container.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1440);
});

test('左侧锚点保持内容左对齐、窄屏主页网格不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  const layout = await openLayoutPanel(page);
  await layout.getByRole('button', { name: '左侧锚点' }).click();
  // 模态设置面板会隐藏主页内容；先关闭再检查主页各区域。
  await closeSettings(page);

  await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'left-stack');
  await expect(page.locator('[data-layout-region="clock"]')).toBeVisible();
  await expect(page.locator('[data-layout-region="search"]')).toBeVisible();
  await expect(page.getByRole('region', { name: '快捷方式' })).toHaveAttribute('data-layout-alignment', 'start');
  const clock = await page.locator('[data-layout-region="clock"]').boundingBox();
  const search = await page.locator('[data-layout-region="search"]').boundingBox();
  const shortcuts = await page.locator('[data-layout-region="shortcuts"]').boundingBox();
  expect(clock && search && shortcuts && clock.x < search.x + 2 && search.x < shortcuts.x + 2).toBe(true);
  await expect.poll(() => page.locator('[data-layout-region="clock"] time').evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThan(100);
  expect(shortcuts && shortcuts.x + shortcuts.width).toBeLessThan(1100);

  await expect(page.getByRole('navigation', { name: '分组' })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'left-stack');
  await expect(page.locator('[data-layout-alignment="start"]')).toBeVisible();
});

