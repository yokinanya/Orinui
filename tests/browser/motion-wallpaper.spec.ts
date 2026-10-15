import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { configureBackground } from './contrast-helpers';
import { expectPhotoControlContrast, expectPhotoTreatment } from './contrast-measurement';

const FORMATS = ['mp4', 'webm', 'gif', 'webp'] as const;
const fixture = (extension: string) => fileURLToPath(new URL(`../fixtures/motion.${extension}`, import.meta.url));

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} 主题动态视频画面中的文字和主页控件可读`, async ({ page }) => {
    await configureBackground(page, { name: '动态视频对比', theme, background: { kind: 'default' }, dynamic: true });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '动态壁纸', exact: true }).click();
    await page.getByLabel('上传动态壁纸', { exact: true }).setInputFiles(fixture('webm'));
    await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible();
    await page.getByRole('slider', { name: '动态壁纸遮罩强度（%）' }).press('Home');
    await expect(page.getByLabel('当前动态壁纸遮罩强度')).toHaveText('0%');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    // 固定原视频画面供两次像素采样比较，不用静态封面替代视频背景。
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
    await expectPhotoTreatment(page);
    await expectPhotoControlContrast(page);
  });
}

async function uploadMotion(page: Page, extension: string) {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '动态壁纸', exact: true }).click();
  await page.getByLabel('上传动态壁纸', { exact: true }).setInputFiles(fixture(extension));
  await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible();
}

for (const extension of FORMATS) {
  test(`${extension} 壁纸保留动态内容、暂停显示封面并可恢复播放`, async ({ page }) => {
    await uploadMotion(page, extension);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
    if (extension === 'mp4' || extension === 'webm') {
      await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => !element.paused && element.muted && element.loop)).toBe(true);
    } else {
      await expect(page.locator('[aria-hidden="true"] > img')).toBeVisible();
    }
    await page.getByRole('button', { name: '暂停动态壁纸', exact: true }).click();
    if (extension === 'mp4' || extension === 'webm') await expect(page.locator('video')).toBeHidden();
    await expect(page.getByRole('button', { name: '播放动态壁纸', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
    await page.getByRole('button', { name: '播放动态壁纸', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停动态壁纸', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '暂停动态壁纸', exact: true })).toBeVisible();
  });
}

test('减少动态效果时默认静态，主动播放后可停止；错误素材不替换已有壁纸', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await uploadMotion(page, 'mp4');
  await expect(page.getByText('已跟随系统减少动态效果；可主动播放。')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
  await expect(page.locator('video')).toBeHidden();
  await page.getByRole('button', { name: '播放动态壁纸', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
  await page.getByRole('button', { name: '暂停动态壁纸', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传动态壁纸', { exact: true }).setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toContainText('有效');
  await expect(page.getByAltText('动态壁纸封面预览')).toBeVisible();
});

test('ZIP 包含原始视频并在重置后恢复；恢复后视频继续播放', async ({ page }) => {
  await uploadMotion(page, 'webm');
  await page.getByRole('tab', { name: '数据', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ZIP', exact: true }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error('ZIP 备份未下载');
  const entries = unzipSync(await readFile(path));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']!));
  const media = manifest.assets[0];
  expect(media.motion.kind).toBe('video');
  expect(media.motion.poster).toBeUndefined();
  expect(Buffer.from(entries[`assets/${media.id}`]!)).toEqual(await readFile(fixture('webm')));
  await page.getByRole('button', { name: '重置本地数据', exact: true }).click();
  await page.getByRole('button', { name: '永久重置', exact: true }).click();
  await page.getByLabel('选择本地 ZIP 备份文件').setInputFiles({ name: download.suggestedFilename(),
    mimeType: 'application/zip', buffer: await readFile(path) });
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
});
