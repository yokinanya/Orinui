import { expect, test, type Page } from '@playwright/test';

const TEMPLATES = [
  ['居中留白', 'centered'], ['顶部工作台', 'top-search'],
  ['左侧锚点', 'left-stack'], ['左右分区', 'split'],
] as const;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1024, height: 600 }];

async function openLayout(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  return page.getByRole('tabpanel', { name: '布局', exact: true });
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test(`四种模板位置、隐藏及刷新保留 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/newtab.html');
    for (const [name, id] of TEMPLATES) {
      const panel = await openLayout(page);
      await panel.getByRole('button', { name, exact: true }).click();
      await closeSettings(page);
      await expect(page.locator('main')).toHaveAttribute('data-layout-style', id);
      await expect(page.getByRole('search')).toBeVisible();
      await expect(page.getByRole('region', { name: '快捷方式', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`缺少 ${selector}`);
        return element.getBoundingClientRect();
      };
      const clock = box('[data-layout-region="clock"]');
      const search = box('[data-layout-region="search"]');
      const grid = box('[data-layout-region="shortcuts"]');
      return { separated: clock.right < search.left, aligned: Math.abs(search.left - grid.left) < 2, below: grid.top > search.bottom };
    });
    expect(geometry).toEqual({ separated: true, aligned: true, below: true });
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-layout-style', 'split');
    const panel = await openLayout(page);
    await panel.getByRole('switch', { name: '显示时钟', exact: true }).click();
    await closeSettings(page);
    await expect(page.locator('time')).toHaveCount(0);
    await expect(page.getByRole('search')).toBeVisible();
    await openLayout(page);
    await panel.getByRole('switch', { name: '显示搜索', exact: true }).click();
    await panel.getByRole('switch', { name: '显示快捷方式', exact: true }).click();
    await closeSettings(page);
    await expect(page.getByText('主页内容已隐藏', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '恢复主页内容', exact: true }).click();
    await expect(page.locator('time')).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();
  });
}
