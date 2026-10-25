import { expect, test } from '@playwright/test';
import { rasterFile } from './source-fixtures';

const TEST_TIMEOUT_MS = 60_000;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 375, height: 800 }];

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px 壁纸库先预览再应用，并在详情管理本地素材`, async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    await page.setViewportSize(viewport);
    await page.goto('/newtab.html');
    await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await page.getByLabel('上传照片', { exact: true }).setInputFiles(await rasterFile(page, 'first.png'));
    await expect(page.getByRole('slider', { name: '照片遮罩强度（%）' })).toBeVisible();
    await page.getByLabel('上传照片', { exact: true }).setInputFiles(await rasterFile(page, 'second.png'));
    await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
    await expect(page.getByRole('button', { name: '返回外观', exact: true })).toBeVisible();
    const cards = page.getByRole('button', { name: /^查看.+详情$/ });
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('已应用');
    const editor = page.locator('[aria-label="壁纸预览和编辑"]');
    await expect(editor.getByRole('img')).toHaveCount(0);
    await expect(page.getByText('当前背景', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
    await expect(page.getByRole('button', { name: '默认', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await expect(page.locator('#photo-url')).toHaveValue('');
    await expect(page.getByRole('slider', { name: '照片遮罩强度（%）' })).toHaveCount(0);
    await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
    await cards.last().click();
    const details = page.getByRole('region', { name: '壁纸详情' });
    await expect(details).toBeVisible();
    if (viewport.width === 1440) {
      const libraryBox = await page.getByRole('region', { name: '壁纸库', exact: true }).boundingBox();
      const detailBox = await details.boundingBox();
      const settingsBox = await page.getByRole('dialog', { name: '设置', exact: true }).boundingBox();
      // 遮罩设置在详情卡片内部，不再是详情之外的独立区域。
      expect(libraryBox!.x + libraryBox!.width).toBeLessThan(detailBox!.x);
      expect(detailBox!.width).toBeLessThan(libraryBox!.width / 1.7);
      expect(Math.abs(detailBox!.y - libraryBox!.y)).toBeLessThan(2);
      const filterBox = await page.getByRole('group', { name: '筛选壁纸素材', exact: true }).boundingBox();
      expect(filterBox!.x + filterBox!.width).toBeLessThan(detailBox!.x);
      expect(settingsBox!.width).toBeGreaterThan(1100);
      await expect(cards.first()).toBeVisible();
    }
    await expect(details.getByRole('button', { name: '应用壁纸', exact: true })).toBeEnabled();
    await expect(details.getByText('已应用', { exact: true })).toHaveCount(0);
    const preview = details.getByRole('img');
    await expect(preview).toHaveAttribute('src', /^blob:/);
    await expect(preview).toBeVisible();
    await details.getByRole('button', { name: '壁纸更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '重命名壁纸素材' });
    await rename.getByLabel('素材名称', { exact: true }).fill('本地山景');
    await rename.getByRole('button', { name: '保存名称' }).click();
    await expect(details.getByRole('heading', { name: '本地山景' })).toBeVisible();
    const handle = page.getByRole('button', { name: /拖动.*排序/ }).last();
    await handle.focus();
    await handle.press('Space');
    await handle.press('ArrowLeft');
    await handle.press('Space');
    await details.getByRole('button', { name: '应用壁纸', exact: true }).click();
    await expect(details.getByRole('button', { name: '应用壁纸', exact: true })).toHaveCount(0);
    await expect(details.getByText('已应用', { exact: true })).toBeVisible();
    // 已应用照片的遮罩调整与详情的重命名、删除同在一张卡片内。
    await expect(details.getByRole('slider', { name: '照片遮罩强度（%）' })).toBeVisible();
    const detailFrame = await details.boundingBox();
    const controlsBox = await details.getByRole('slider', { name: '照片遮罩强度（%）' }).boundingBox();
    expect(controlsBox!.y).toBeGreaterThan(detailFrame!.y);
    await details.getByRole('button', { name: '壁纸更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除壁纸素材', exact: true }).click();
    const removal = page.getByRole('alertdialog');
    await expect(removal).toContainText('当前背景会切换为默认中性渐变');
    await removal.getByRole('button', { name: '取消', exact: true }).click();
    await details.getByRole('button', { name: '关闭壁纸详情' }).click();
    await expect(page.getByRole('region', { name: '壁纸详情' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看本地山景详情' })).toBeFocused();
    await expect(cards).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
  });
}
