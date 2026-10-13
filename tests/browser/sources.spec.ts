import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  clearFixtureSource,
  clearPhotoSource,
  clearShortcutIconSource,
  createImageShortcut,
  holdAssetSourceWriteLock,
  ICON_SOURCE,
  PHOTO_SOURCE,
  rasterFile,
  readFixtureState,
  setFixtureSources,
} from './source-fixtures';

test.beforeEach(async ({ page }) => { await page.goto('/newtab.html'); });

test('已保存的图片直链在重新打开时回填，包括资源保留来源的网站旧记录', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  await page.keyboard.press('Escape');
  const link = await createImageShortcut(page);
  await setFixtureSources(page, null);
  await page.reload();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#photo-url')).toHaveValue(PHOTO_SOURCE);
  await page.keyboard.press('Escape');

  await link.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await expect(page.locator('#shortcut-image-url')).toHaveValue(ICON_SOURCE);
});

test('图片来源异步读取完成时不会覆盖用户已输入的地址', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  await page.keyboard.press('Escape');
  await createImageShortcut(page);
  const ids = await setFixtureSources(page);
  await page.reload();

  await holdAssetSourceWriteLock(page, ids.photoId);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const input = page.locator('#photo-url');
  await expect(input).toHaveValue('');
  await input.fill('https://typed.example.test/photo.png');
  await page.evaluate(() => window.__releaseAssetSourceLock?.());

  await expect(page.getByRole('button', { name: '清除来源', exact: true })).toBeVisible();
  await expect(input).toHaveValue('https://typed.example.test/photo.png');
});

test('清除照片和图标来源只移除URL，撤销其他编辑后仍保留并写入JSON备份', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  await page.keyboard.press('Escape');
  const link = await createImageShortcut(page);
  const ids = await setFixtureSources(page);
  await page.reload();
  await clearPhotoSource(page, ids);
  await clearShortcutIconSource(page, link);

  await page.reload();
  await expect(page.getByRole('link', { name: '本地图标网站', exact: true }).locator('img')).toHaveAttribute('src', /^blob:/);
  const state = await readFixtureState(page, ids) as {
    photo: { sourceUrl: string | null; blobSize: number };
    icon: { sourceUrl: string | null; blobSize: number };
    shortcut: { icon: { assetId: string }; iconSourceUrl: string | null; title: string };
    settings: { appearance: { background: { assetId?: string } } };
  };
  expect(state.photo).toMatchObject({ id: ids.photoId, sourceUrl: null });
  expect(state.icon).toMatchObject({ id: ids.iconId, sourceUrl: null });
  expect(state.photo.blobSize).toBeGreaterThan(0);
  expect(state.icon.blobSize).toBeGreaterThan(0);
  expect(state.settings.appearance.background.assetId).toBe(ids.photoId);
  expect(state.shortcut).toMatchObject({ title: '本地图标网站', icon: { assetId: ids.iconId }, iconSourceUrl: null });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: /导出 JSON/ }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('JSON 备份没有落盘');
  const backup = JSON.parse(await readFile(path, 'utf8')) as {
    assets: Array<{ id: string; sourceUrl: string | null }>;
    shortcuts: Array<{ id: string; iconSourceUrl: string | null }>;
  };
  expect(backup.assets.filter(({ id }) => id === ids.photoId || id === ids.iconId).map(({ sourceUrl }) => sourceUrl)).toEqual([null, null]);
  expect(backup.shortcuts.find(({ id }) => id === ids.shortcutId)?.iconSourceUrl).toBeNull();
});

test('来源已被外部清除时显示错误且仍可重试', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, 'photo.png'));
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
  const ids = await page.evaluate(async (sourceUrl) => {
    const opening = indexedDB.open('orinui');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => resolve(opening.result);
    });
    const transaction = database.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    const request = store.getAll();
    let photoId = '';
    request.onsuccess = () => {
      const photo = (request.result as Array<{ id: string; kind: string; sourceUrl: string | null }>).find((asset) => asset.kind === 'background');
      if (!photo) { transaction.abort(); return; }
      photoId = photo.id;
      store.put({ ...photo, sourceUrl });
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('测试来源事务已中止'));
    });
    database.close();
    return photoId;
  }, PHOTO_SOURCE);
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除来源', exact: true })).toBeVisible();
  await clearFixtureSource(page, ids);

  const clear = page.getByRole('button', { name: '清除来源', exact: true });
  await clear.click();
  await expect(page.getByRole('alert')).toContainText('图片没有可清除的来源地址');
  await expect(clear).toBeEnabled();
  await expect(page.getByLabel('照片遮罩强度（%）')).toBeVisible();
});
