import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { rasterFile } from './source-fixtures';

test('详情播放只属于当前动态素材，短窗口长名称设置可独立滚动', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
  await page.getByLabel('上传照片', { exact: true }).setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByLabel('当前照片遮罩强度')).toHaveText('55%');
  await page.getByRole('button', { name: '动态壁纸', exact: true }).click();
  await page.getByLabel('上传动态壁纸', { exact: true }).setInputFiles(fileURLToPath(new URL('../fixtures/motion.webm', import.meta.url)));
  await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible();
  await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
  const details = page.getByRole('region', { name: '壁纸详情', exact: true });
  await page.getByRole('button', { name: '查看WEBP 照片详情', exact: true }).click();
  await expect(details.getByRole('button', { name: '暂停动态壁纸', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看WebM 视频详情', exact: true }).click();
  await expect(details.getByRole('button', { name: '暂停动态壁纸', exact: true })).toBeVisible();
  await details.getByRole('button', { name: '壁纸更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('素材名称', { exact: true }).fill('很长的动态壁纸名称'.repeat(5));
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(details.getByRole('button', { name: '应用壁纸', exact: true })).toHaveCount(0);
  const geometry = await details.locator('.wallpaper-detail-content').evaluate((node) => ({
    scrollable: getComputedStyle(node).overflowY, height: node.clientHeight, contentHeight: node.scrollHeight,
    bottom: node.getBoundingClientRect().bottom, viewport: innerHeight,
  }));
  expect(geometry.scrollable).toBe('auto');
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.contentHeight).toBeLessThanOrEqual(geometry.height);
  expect(geometry.bottom).toBeLessThan(geometry.viewport);
  const mask = details.getByLabel('当前动态壁纸遮罩强度');
  await mask.scrollIntoViewIfNeeded();
  await expect(mask).toBeInViewport();
  await details.getByRole('slider', { name: '动态壁纸遮罩强度（%）' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(mask).toHaveText('56%');
});
