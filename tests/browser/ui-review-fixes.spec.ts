import { expect, test } from '@playwright/test';
import { BACKUP_VERSION } from '@/domain/backup';
import { toPortableSettings } from '@/domain/backup-settings';
import { createDefaultSettings } from '@/domain/settings';
import { importShortcutFixture } from './contrast-helpers';

const WIDE_VIEWPORT = { width: 1200, height: 800 };
const CENTER_TOLERANCE = 2;
const SHORTCUT = { id: 'site-a', folderId: null, title: '示例站点', url: 'https://example.com/', order: 0, icon: { kind: 'letter' }, iconSourceUrl: null };

function shortcutFixture(shortcuts: readonly object[]) {
  const defaults = createDefaultSettings();
  return {
    formatVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    assets: [],
    folders: [],
    shortcuts,
    // 当前 ZIP 清单不含运行时的 `bookmarks` 偏好，走与导出相同的可移植设置转换。
    settings: toPortableSettings({
      ...defaults,
      layout: { ...defaults.layout, order: [...defaults.layout.order], hidden: [...defaults.layout.hidden] },
    }),
  };
}

/** 校验当前页面发出的错误文本来定位备份校验失败的原因。 */
async function importFixture(page: import('@playwright/test').Page, shortcuts: readonly object[]) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '数据', exact: true }).click();
  await importShortcutFixture(page, shortcutFixture(shortcuts));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden();
}

test('网站名称留空时显示地址域名，且仍保留可访问名称', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await importFixture(page, [
    SHORTCUT,
    { ...SHORTCUT, id: 'unnamed', order: 1, title: '', url: 'https://unnamed.example.com/' },
  ]);

  const link = page.getByRole('link', { name: 'unnamed.example.com', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('title', 'unnamed.example.com');
  await expect(page.getByRole('link', { name: '示例站点', exact: true })).toBeVisible();
});

test('编辑模式的网站操作入口可聚焦并打开菜单', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await importFixture(page, [SHORTCUT]);

  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  const actions = page.getByRole('button', { name: '示例站点 的操作', exact: true });
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '编辑', exact: true })).toBeVisible();
});

test('添加网站弹窗与主页动效同时存在时仍居中，名称留空可直接保存', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - WIDE_VIEWPORT.width / 2)).toBeLessThan(CENTER_TOLERANCE);

  await dialog.getByLabel('网址', { exact: true }).fill('only-url.example.com');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.locator('[data-slot="field-error"]')).toHaveCount(0);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: 'only-url.example.com', exact: true })).toBeVisible();
});
