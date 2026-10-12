import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PHOTO_SOURCE = 'https://images.example.test/photo.jpg';
const ICON_SOURCE = 'https://icons.example.test/icon.png';

declare global {
  interface Window {
    __releaseAssetSourceLock?: () => void;
  }
}

async function rasterFile(page: Page, name: string) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('缺少画布');
    context.fillStyle = '#317b91';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    if (!encoded) throw new Error('画布编码未返回图片内容');
    return encoded;
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

async function setFixtureSources(page: Page, iconShortcutSource: string | null = ICON_SOURCE) {
  return page.evaluate(({ photoSource, iconSource, shortcutSource }) => new Promise<{ photoId: string; iconId: string; shortcutId: string }>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(['assets', 'shortcuts'], 'readwrite');
      const assetStore = transaction.objectStore('assets');
      const shortcutStore = transaction.objectStore('shortcuts');
      let result: { photoId: string; iconId: string; shortcutId: string } | null = null;
      transaction.onerror = () => reject(transaction.error ?? new Error('测试来源数据写入失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('测试来源事务已中止'));
      transaction.oncomplete = () => {
        database.close();
        if (result) resolve(result);
      };
      const assetRequest = assetStore.getAll();
      assetRequest.onerror = () => reject(assetRequest.error ?? new Error('无法读取图片资源'));
      assetRequest.onsuccess = () => {
        const records = assetRequest.result as Array<{ id: string; kind: string; sourceUrl: string | null }>;
        const photo = records.find((asset) => asset.kind === 'background');
        const icon = records.find((asset) => asset.kind === 'icon');
        if (!photo || !icon) {
          transaction.abort();
          reject(new Error('缺少已上传的测试图片'));
          return;
        }
        assetStore.put({ ...photo, sourceUrl: photoSource });
        assetStore.put({ ...icon, sourceUrl: iconSource });
        const shortcutRequest = shortcutStore.getAll();
        shortcutRequest.onerror = () => reject(shortcutRequest.error ?? new Error('无法读取网站记录'));
        shortcutRequest.onsuccess = () => {
          const shortcuts = shortcutRequest.result as Array<{
            id: string; icon: { kind: string; assetId?: string }; iconSourceUrl: string | null;
          }>;
          const shortcut = shortcuts.find((item) => item.icon.kind === 'asset' && item.icon.assetId === icon.id);
          if (!shortcut) {
            transaction.abort();
            reject(new Error('缺少引用测试图标的网站'));
            return;
          }
          shortcutStore.put({ ...shortcut, iconSourceUrl: shortcutSource });
          result = { photoId: photo.id, iconId: icon.id, shortcutId: shortcut.id };
        };
      };
    };
  }), { photoSource: PHOTO_SOURCE, iconSource: ICON_SOURCE, shortcutSource: iconShortcutSource });
}

async function clearFixtureSource(page: Page, assetId: string) {
  await page.evaluate((id) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('assets', 'readwrite');
      transaction.objectStore('assets').get(id).onsuccess = (event) => {
        const request = event.target as IDBRequest<{ id: string; sourceUrl: string | null } | undefined>;
        const asset = request.result;
        if (!asset) {
          transaction.abort();
          reject(new Error('测试图片资源不存在'));
          return;
        }
        transaction.objectStore('assets').put({ ...asset, sourceUrl: null });
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('测试来源修改失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('测试来源事务已中止'));
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), assetId);
}

async function holdAssetSourceWriteLock(page: Page, assetId: string) {
  await page.evaluate((id) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('assets', 'readwrite');
      const store = transaction.objectStore('assets');
      const keepAlive = () => {
        const request = store.get(id);
        request.onerror = () => reject(request.error ?? new Error('无法保持测试事务'));
        request.onsuccess = keepAlive;
      };
      transaction.onabort = () => { database.close(); resolve(); };
      transaction.oncomplete = () => { database.close(); resolve(); };
      window.__releaseAssetSourceLock = () => {
        window.__releaseAssetSourceLock = undefined;
        transaction.abort();
      };
      keepAlive();
      resolve();
    };
  }), assetId);
}

async function readFixtureState(page: Page, assetIds: { photoId: string; iconId: string; shortcutId: string }) {
  return page.evaluate((ids) => new Promise((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(['assets', 'shortcuts', 'settings'], 'readonly');
      const assets = transaction.objectStore('assets');
      const photoRequest = assets.get(ids.photoId);
      const iconRequest = assets.get(ids.iconId);
      const shortcutRequest = transaction.objectStore('shortcuts').get(ids.shortcutId);
      const settingsRequest = transaction.objectStore('settings').get('app');
      const state: Record<string, any> = {};
      photoRequest.onsuccess = () => { state.photo = assetSummary(photoRequest.result); };
      iconRequest.onsuccess = () => { state.icon = assetSummary(iconRequest.result); };
      shortcutRequest.onsuccess = () => { state.shortcut = shortcutRequest.result; };
      settingsRequest.onsuccess = () => { state.settings = settingsRequest.result; };
      transaction.onerror = () => reject(transaction.error ?? new Error('无法读取测试数据'));
      transaction.oncomplete = () => {
        database.close();
        resolve(state);
      };
    };
    function assetSummary(asset: { id: string; kind: string; sourceUrl: string | null; blob: Blob } | undefined) {
      return asset && { id: asset.id, kind: asset.kind, sourceUrl: asset.sourceUrl, blobSize: asset.blob.size };
    }
  }), assetIds);
}

async function createImageShortcut(page: Page) {
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('本地图标网站');
  await page.getByLabel('网址', { exact: true }).fill('example.com');
  await page.getByLabel('上传图标').setInputFiles(await rasterFile(page, 'icon.png'));
  await expect(page.getByRole('img', { name: '图标预览' })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const link = page.getByRole('link', { name: '本地图标网站', exact: true });
  await expect(link.locator('img')).toHaveAttribute('src', /^blob:/);
  return link;
}

async function clearPhotoSource(page: Page, ids: { photoId: string; iconId: string; shortcutId: string }) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const photoClear = page.getByRole('button', { name: '清除来源', exact: true });
  await expect(photoClear).toBeVisible();
  await holdAssetSourceWriteLock(page, ids.photoId);
  const photoClearResult = page.getByRole('button', { name: '正在清除…', exact: true });
  const photoClick = photoClear.click();
  await expect(photoClearResult).toBeDisabled();
  await page.evaluate(() => window.__releaseAssetSourceLock?.());
  await photoClick;
  await expect(photoClear).toHaveCount(0);
  await expect(page.locator('#photo-url')).toHaveValue('');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--wallpaper'))).toContain('blob:');
  const state = await readFixtureState(page, ids) as { photo: { sourceUrl: string | null }; icon: { sourceUrl: string | null } };
  expect(state.photo.sourceUrl).toBeNull();
  expect(state.icon.sourceUrl).toBe(ICON_SOURCE);
  await page.keyboard.press('Escape');
}

async function clearShortcutIconSource(page: Page, link: Locator) {
  await link.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const iconClear = page.getByRole('button', { name: '清除来源', exact: true });
  await expect(iconClear).toBeVisible();
  await page.getByLabel('名称', { exact: true }).fill('取消时保留原名称');
  await iconClear.click();
  await expect(iconClear).toHaveCount(0);
  await expect(page.locator('#shortcut-image-url')).toHaveValue('');
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('取消时保留原名称');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(link).toBeVisible();
  await expect(link).toContainText('本地图标网站');
  await expect(link.locator('img')).toHaveAttribute('src', /^blob:/);
}

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
