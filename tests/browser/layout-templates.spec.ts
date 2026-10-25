import { expect, test } from '@playwright/test';

// 主页已统一为固定顶部时钟/搜索加双列网格；本文件保留跨宽度几何与刷新回归。
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1024, height: 600 }];

for (const viewport of VIEWPORTS) {
  test(`主页双列网格、时钟搜索顺序及刷新保留 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/newtab.html');
    await expect(page.getByRole('button', { name: '整理主页', exact: true })).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();

    const search = await page.getByRole('search').boundingBox();
    const region = await page.getByRole('region', { name: '快捷方式', exact: true }).boundingBox();
    expect(search && region && region.y > search.y + search.height).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: '整理主页', exact: true })).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.locator('time')).toBeVisible();
  });
}
