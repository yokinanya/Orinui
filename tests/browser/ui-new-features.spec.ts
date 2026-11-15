import { expect, test, type Page } from '@playwright/test';
import { rasterFile } from './source-fixtures';

const NARROW_VIEWPORT = { width: 375, height: 700 };

async function installWriteProbe(page: Page) {
  await page.addInitScript(() => {
    // Dexie 在 IndexedDB 之上追加了 update，原生 IDBObjectStore 类型里没有它。
    interface PatchedStore extends IDBObjectStore {
      update?: (...args: unknown[]) => IDBRequest;
    }
    const proto = IDBObjectStore.prototype as PatchedStore;
    const originalPut = proto.put;
    const originalUpdate = proto.update;
    const writes: { op: string; store: string }[] = [];
    (window as unknown as { __writes: typeof writes }).__writes = writes;
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      writes.push({ op: 'put', store: this.name });
      return originalPut.apply(this, args);
    };
    if (originalUpdate) {
      proto.update = function (this: IDBObjectStore, ...args: unknown[]) {
        writes.push({ op: 'update', store: this.name });
        return originalUpdate.apply(this, args) as IDBRequest;
      };
    }
  });
}

function resetWrites(page: Page) {
  return page.evaluate(() => { (window as unknown as { __writes: unknown[] }).__writes.length = 0; });
}

function assetWrites(page: Page) {
  return page.evaluate(() => (window as unknown as { __writes: { op: string; store: string }[] }).__writes
    .filter((entry) => entry.store === 'assets'));
}

function settingsWrites(page: Page) {
  return page.evaluate(() => (window as unknown as { __writes: { op: string; store: string }[] }).__writes
    .filter((entry) => entry.store === 'settings'));
}

function backgroundRows(page: Page) {
  return page.evaluate(() => new Promise<{ id: string; createdAt: number }[]>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction(['assets'], 'readonly').objectStore('assets').getAll();
      request.onsuccess = () => {
        const rows = (request.result as { id: string; kind?: string; createdAt?: number }[])
          .filter((row) => row.kind === 'background')
          .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
          .map((row) => ({ id: row.id, createdAt: row.createdAt ?? 0 }));
        database.close();
        resolve(rows);
      };
      request.onerror = () => reject(request.error ?? new Error('读取素材失败'));
    };
  }));
}

function layoutOrder(page: Page) {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction(['settings'], 'readonly').objectStore('settings').getAll();
      request.onsuccess = () => {
        const row = (request.result as { layout?: { order?: string[] } }[])[0];
        database.close();
        resolve(row?.layout?.order ?? []);
      };
      request.onerror = () => reject(request.error ?? new Error('读取设置失败'));
    };
  }));
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
}

async function openWallpaperLibrary(page: Page, count: number) {
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  for (let index = 0; index < count; index += 1) {
    await page.getByRole('button', { name: '添加壁纸', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await page.getByLabel('上传照片').setInputFiles(await rasterFile(page, `photo-${index}.png`));
    await expect(page.getByRole('slider', { name: '照片遮罩强度（%）' })).toBeVisible();
    await page.getByRole('button', { name: '返回壁纸库', exact: true }).click();
  }
  await expect(page.locator('[data-asset-id]')).toHaveCount(count);
}

async function cardIds(page: Page) {
  return page.locator('[data-asset-id]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-asset-id')));
}

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
  const library = page.getByRole('region', { name: '壁纸库', exact: true });
  const status = library.getByRole('status');
  const draggedId = await cards.last().getAttribute('data-asset-id');
  await expect(status).toContainText(`Draggable item ${draggedId} was moved over droppable area ${draggedId}.`);
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText(`was moved over droppable area ${targetId}.`);
  await page.keyboard.press('Space');
  await expect(cards.first()).toContainText('城市夜景');
  await expect(cards.last()).toContainText('已应用');
  await expect(cards.first()).not.toContainText('已应用');
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

test('壁纸键盘拖拽 Escape 只取消拖拽，随后无关按键不写库，重新拖拽仍可用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWriteProbe(page);
  await page.goto('/newtab.html');
  await openSettings(page);
  await openWallpaperLibrary(page, 2);

  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const before = await backgroundRows(page);
  const beforeIds = await cardIds(page);
  await resetWrites(page);

  const library = page.getByRole('region', { name: '壁纸库', exact: true });
  const status = library.getByRole('status');
  const draggedId = beforeIds[1];
  const handle = page.getByRole('button', { name: /拖动.*排序/ }).last();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  // 以传感器自己的 live region 播报作为“方向键已被处理”的可观察信号，避免固定等待。
  await expect(status).toContainText('Draggable item ' + draggedId + ' was moved over droppable area ' + draggedId + '.');
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('Draggable item ' + draggedId + ' was moved over droppable area ' + beforeIds[0] + '.');
  await expect.poll(() => cardIds(page)).toEqual(beforeIds);
  await page.keyboard.press('Escape');

  // 第一次 Escape：只取消拖拽，弹层保持打开，不产生任何写入。
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toBeVisible();
  await expect.poll(() => cardIds(page)).toEqual(beforeIds);
  expect(await assetWrites(page)).toEqual([]);
  expect(await backgroundRows(page)).toEqual(before);
  await expect(page.getByText('素材顺序已保存', { exact: true })).toHaveCount(0);

  // 取消后无关按键不得触发旧会话的 onDragEnd。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const key of ['Space', 'Enter', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(key);
  }
  await expect.poll(() => backgroundRows(page)).toEqual(before);
  expect(await assetWrites(page)).toEqual([]);
  expect(await cardIds(page)).toEqual(beforeIds);

  // 第二次 Escape（未激活拖拽）保留原有关闭语义。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 同页重开：下一次正常键盘拖拽必须仍然可用且只写一批。
  await openSettings(page);
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await expect(page.locator('[data-asset-id]')).toHaveCount(2);
  await resetWrites(page);
  const reopenStatus = page.getByRole('region', { name: '壁纸库', exact: true }).getByRole('status');
  const nextHandle = page.getByRole('button', { name: /拖动.*排序/ }).last();
  await nextHandle.focus();
  await page.keyboard.press('Space');
  await expect(nextHandle).toHaveAttribute('aria-pressed', 'true');
  await expect(reopenStatus).toContainText('Draggable item ' + beforeIds[1] + ' was moved over droppable area ' + beforeIds[1] + '.');
  await page.keyboard.press('ArrowLeft');
  await expect(reopenStatus).toContainText('Draggable item ' + beforeIds[1] + ' was moved over droppable area ' + beforeIds[0] + '.');
  await page.keyboard.press('Space');
  await expect.poll(() => cardIds(page)).toEqual([beforeIds[1], beforeIds[0]]);
  await expect.poll(async () => (await assetWrites(page)).length).toBeGreaterThan(0);
  const savedRows = await backgroundRows(page);
  expect(savedRows.map((row) => row.id)).toEqual([beforeIds[1], beforeIds[0]]);

  // 刷新后顺序保持。
  await page.reload();
  await page.waitForTimeout(500);
  await openSettings(page);
  await page.getByRole('button', { name: '壁纸', exact: true }).click();
  await page.getByRole('button', { name: '打开壁纸库', exact: true }).click();
  await expect(page.locator('[data-asset-id]')).toHaveCount(2);
  await expect.poll(() => cardIds(page)).toEqual([beforeIds[1], beforeIds[0]]);
});

test('布局区域拖拽中 Escape 只取消拖拽，第二次 Escape 才关闭弹层', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installWriteProbe(page);
  await page.goto('/newtab.html');
  await openSettings(page);
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  await expect(layout).toBeVisible();

  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const before = await layoutOrder(page);
  expect(before.length).toBeGreaterThan(1);
  const source = layout.locator('ol.settings-slot-list > li').first();
  const handle = source.getByRole('button', { name: /^拖动.*排序/ });
  const box = await handle.boundingBox();
  if (!box) throw new Error('布局区域手柄未显示');
  await resetWrites(page);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(dialog).toBeVisible();
  await expect.poll(() => layoutOrder(page)).toEqual(before);
  expect(await settingsWrites(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => layoutOrder(page)).toEqual(before);
});

test('指针拖拽中焦点不在手柄时 Escape 仍取消会话，不提交布局顺序', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installWriteProbe(page);
  await page.goto('/newtab.html');
  await openSettings(page);
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  await expect(layout).toBeVisible();

  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const before = await layoutOrder(page);
  const source = layout.locator('ol.settings-slot-list > li').first();
  const handle = source.getByRole('button', { name: /^拖动.*排序/ });
  const target = layout.locator('ol.settings-slot-list > li').nth(1);
  const box = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!box || !targetBox) throw new Error('布局区域手柄或目标行未显示');
  await resetWrites(page);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  // 指针拖拽不保证手柄仍有焦点：焦点落到弹层内的 tab 上，Escape 必须仍能取消会话。
  await page.getByRole('tab', { name: '外观', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(dialog).toBeVisible();
  await expect.poll(() => layoutOrder(page)).toEqual(before);
  expect(await settingsWrites(page)).toEqual([]);

  // 取消后无关按键不得触发旧会话的提交。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const key of ['Space', 'Enter', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.press(key);
  }
  await expect.poll(() => layoutOrder(page)).toEqual(before);
  expect(await settingsWrites(page)).toEqual([]);

  // 第二次 Escape 关闭弹层。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 同页重开后的正常指针拖拽必须仍然提交，且只写一次。
  await openSettings(page);
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const reopened = page.getByRole('tabpanel', { name: '布局', exact: true });
  await expect(reopened).toBeVisible();
  await resetWrites(page);
  const source2 = reopened.locator('ol.settings-slot-list > li').first();
  const handle2 = source2.getByRole('button', { name: /^拖动.*排序/ });
  const target2 = reopened.locator('ol.settings-slot-list > li').nth(1);
  const box2 = await handle2.boundingBox();
  const target2Box = await target2.boundingBox();
  if (!box2 || !target2Box) throw new Error('重开后布局手柄未显示');
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(target2Box.x + target2Box.width / 2, target2Box.y + target2Box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => layoutOrder(page)).toEqual([before[1], before[0], ...before.slice(2)]);
  expect((await settingsWrites(page)).length).toBe(1);
});

test('键盘拖拽激活时关闭按钮与遮罩都拒绝关闭弹层，取消后不写库', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWriteProbe(page);
  await page.goto('/newtab.html');
  await openSettings(page);
  await openWallpaperLibrary(page, 2);

  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const status = page.getByRole('region', { name: '壁纸库', exact: true }).getByRole('status');
  const before = await backgroundRows(page);
  const beforeIds = await cardIds(page);
  const armDrag = async () => {
    const handle = page.getByRole('button', { name: /拖动.*排序/ }).last();
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toContainText('was moved over droppable area ' + beforeIds[1] + '.');
    return handle;
  };

  // 键盘会话激活时点关闭按钮：拒绝关闭，弹层仍在，拖拽仍在，且没有任何写入。
  await resetWrites(page);
  let handle = await armDrag();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  expect(await assetWrites(page)).toEqual([]);
  expect(await backgroundRows(page)).toEqual(before);

  // 点遮罩同样拒绝关闭。
  await page.locator('[data-slot="dialog-overlay"]').click({ force: true, position: { x: 5, y: 5 } });
  await expect(dialog).toBeVisible();
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  expect(await assetWrites(page)).toEqual([]);

  // 用 Escape 取消这次会话，弹层保留，顺序不变，无写入。
  await page.keyboard.press('Escape');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toBeVisible();
  await expect.poll(() => cardIds(page)).toEqual(beforeIds);
  expect(await assetWrites(page)).toEqual([]);
  expect(await backgroundRows(page)).toEqual(before);
  await expect(page.getByText('素材顺序已保存', { exact: true })).toHaveCount(0);

  // 取消后关闭按钮恢复原语义。
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => backgroundRows(page)).toEqual(before);
});
