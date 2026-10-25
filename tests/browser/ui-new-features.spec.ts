import { expect, test } from '@playwright/test';
import { rasterFile } from './source-fixtures';

const NARROW_VIEWPORT = { width: 375, height: 700 };

test('壁纸素材库支持重命名与上下调整顺序', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByRole('slider', { name: '照片遮罩强度（%）' })).toBeVisible();

  await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
  const cards = page.locator('[data-asset-id]');
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('button', { name: /^查看/ }).click();
  const details = page.getByRole('region', { name: '壁纸详情', exact: true });
  await details.getByRole('button', { name: '壁纸更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名壁纸素材' });
  await dialog.getByLabel('素材名称', { exact: true }).fill('城市夜景');
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(details.getByRole('heading', { name: '城市夜景', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
  await page.getByRole('button', { name: '照片', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByRole('slider', { name: '照片遮罩强度（%）' })).toBeVisible();
  await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).not.toContainText('城市夜景');
  const targetId = await cards.first().getAttribute('data-asset-id');
  await cards.filter({ hasText: '城市夜景' }).getByRole('button', { name: '查看城市夜景详情', exact: true }).click();
  const handle = page.getByRole('button', { name: /拖动.*排序/ }).last();
  await handle.focus();
  await handle.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  const status = page.locator('[id^="DndLiveRegion-"]');
  await expect(status).toContainText(`Draggable item ${await cards.last().getAttribute('data-asset-id')} was moved over droppable area ${await cards.last().getAttribute('data-asset-id')}.`);
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText(`was moved over droppable area ${targetId}.`);
  await page.keyboard.press('Space');
  await expect(cards.first()).toContainText('城市夜景');
  await expect(cards.last()).toContainText('当前壁纸');
  await expect(cards.first()).not.toContainText('当前壁纸');
});

test('搜索结果底部显示键盘操作提示', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto('/newtab.html');
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.click();
  await input.fill('示例');
  const list = page.getByRole('listbox', { name: '搜索结果' });
  await expect(list).toBeVisible();
  const footer = page.getByRole('search').locator('p');
  await expect(footer.locator('kbd')).toHaveText(['↑', '↓', 'Enter', 'Esc']);
  await expect(footer).toContainText('搜索');
  await expect(footer).toContainText('关闭');
  await input.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toHaveCount(1);
});
