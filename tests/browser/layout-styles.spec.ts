import { expect, test, type Page } from '@playwright/test';

async function openLayoutPanel(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  return page.getByRole('tabpanel', { name: '布局', exact: true });
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
}

test('固定顶部时钟与搜索，下方双列网格紧随其后', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.locator('time')).toBeVisible();

  const grid = page.locator('[data-home-grid]');
  const search = await page.getByRole('search').boundingBox();
  const box = await grid.boundingBox();
  expect(search && box && box.y > search.y + search.height).toBe(true);
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '));
  expect(columns).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('区域显隐与恢复主页内容', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  const layout = await openLayoutPanel(page);
  await layout.getByRole('switch', { name: '显示时钟', exact: true }).click();
  await closeSettings(page);
  await expect(page.locator('time')).toHaveCount(0);
  await expect(page.getByRole('search')).toBeVisible();

  await openLayoutPanel(page);
  await layout.getByRole('switch', { name: '显示搜索', exact: true }).click();
  await layout.getByRole('switch', { name: '显示主页内容', exact: true }).click();
  await closeSettings(page);
  await expect(page.getByText('主页内容已隐藏', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复主页内容', exact: true }).click();
  await expect(page.locator('time')).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
});

test('页面宽度限制内容宽度且窄视口不产生横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  const layout = await openLayoutPanel(page);
  const widthField = layout.getByRole('group', { name: '页面宽度' });
  await widthField.getByRole('button', { name: '紧凑', exact: true }).click();
  await closeSettings(page);
  const width = await page.locator('[data-home-grid]').evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(640);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
