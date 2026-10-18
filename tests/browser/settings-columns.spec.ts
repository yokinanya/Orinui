import { expect, test } from '@playwright/test';

for (const width of [1440, 900]) {
  test(`设置按内容宽度切换列数 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/newtab.html');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const name of ['布局', '外观', '搜索', '数据']) {
      await page.getByRole('tab', { name, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name, exact: true });
      const grid = panel.locator('.settings-columns');
      await expect(grid).toBeVisible();
      const dimensions = await grid.evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        overflow: element.scrollWidth > element.clientWidth,
      }));
      expect(dimensions.columns).toBe(width === 1440 ? 2 : 1);
      expect(dimensions.overflow).toBe(false);
      if (name === '数据') {
        const sections = await grid.locator(':scope > section').evaluateAll((elements) =>
          elements.map((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y,
            overflow: element.scrollWidth > element.clientWidth })));
        expect(sections.every(({ overflow }) => !overflow)).toBe(true);
        if (width === 1440) {
          expect(sections[1]!.x).toBeLessThan(sections[2]!.x);
          expect(Math.abs(sections[1]!.y - sections[2]!.y)).toBeLessThan(2);
        }
      }
    }
  });
}
