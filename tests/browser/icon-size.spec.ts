import { expect, test, type Locator, type Page } from '@playwright/test';

async function setOccupancy(page: Page, value: number) {
  const slider = page.getByRole('slider', { name: '图标占比' });
  await slider.press('Home');
  for (let step = 50; step < value; step += 1) await slider.press('ArrowRight');
  await expect(page.getByLabel('当前图标占比')).toHaveText(`${value}%`);
}

async function expectTileFrame(page: Page, title: string) {
  const frame = page.getByRole('link', { name: title, exact: true }).locator('span[aria-hidden="true"]').first();
  await expect(frame).toHaveCSS('width', '48px');
  await expect(frame).toHaveCSS('height', '48px');
}

async function expectRenderedWidth(locator: Locator, expected: number) {
  const actual = await locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).width));
  expect(actual).toBeGreaterThan(expected - 0.1);
  expect(actual).toBeLessThan(expected + 0.1);
}

async function openNewShortcut(page: Page) {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('比例测试站点');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
}

async function openShortcutEditor(page: Page) {
  await page.getByRole('link', { name: '比例测试站点', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
}

test('图标占比只改变框内内容，透明预览边框固定，保存与刷新后保留', async ({ page }) => {
  await page.goto('/newtab.html');
  await openNewShortcut(page);
  const previewFrame = page.locator('figure[aria-label="图标预览"] > div').first();
  await expect(previewFrame).toHaveCSS('width', '64px');
  await expect(previewFrame).toHaveCSS('height', '64px');
  await expect(previewFrame).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(previewFrame).toHaveCSS('border-top-width', '1px');
  await setOccupancy(page, 60);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expectTileFrame(page, '比例测试站点');
  const letter = page.getByRole('link', { name: '比例测试站点', exact: true }).locator('span[aria-hidden="true"]').first().locator('span');
  await expect(letter).toHaveCSS('font-size', '14.4px');

  await page.reload();
  await expectTileFrame(page, '比例测试站点');
  await expect(page.getByRole('link', { name: '比例测试站点', exact: true }).locator('span[aria-hidden="true"]').first()
    .locator('span')).toHaveCSS('font-size', '14.4px');
});

test('取消不写入占比，切换图标类型和替换 SVG 保留占比', async ({ page }) => {
  await page.goto('/newtab.html');
  await openNewShortcut(page);
  await setOccupancy(page, 60);
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await openShortcutEditor(page);
  const slider = page.getByRole('slider', { name: '图标占比' });
  await slider.press('End');
  await expect(page.getByLabel('当前图标占比')).toHaveText('100%');
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await openShortcutEditor(page);
  await expect(page.getByLabel('当前图标占比')).toHaveText('60%');
  await page.getByRole('button', { name: '选择内置图标' }).click();
  await page.getByRole('button', { name: '使用爱心图标', exact: true }).click();
  await expect(page.getByLabel('当前图标占比')).toHaveText('60%');
  await page.getByLabel('选择图标文件').setInputFiles({
    name: 'icon.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#37a1b2"/></svg>'),
  });
  const preview = page.getByRole('img', { name: '图标预览', exact: true });
  await expectRenderedWidth(preview, 33.6);
  await expect(page.getByLabel('当前图标占比')).toHaveText('60%');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await expectTileFrame(page, '比例测试站点');
  const tileImage = page.getByRole('link', { name: '比例测试站点', exact: true }).locator('img');
  await expectRenderedWidth(tileImage, 28.8);
  await page.reload();
  await expectTileFrame(page, '比例测试站点');
  await expectRenderedWidth(page.getByRole('link', { name: '比例测试站点', exact: true }).locator('img'), 28.8);
});
