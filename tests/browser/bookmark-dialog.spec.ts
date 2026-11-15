import { expect, test, type Locator, type Page } from '@playwright/test';

import { installBookmarkPlatform } from './bookmark-runtime-fixtures';

/**
 * 文件夹弹层的真实 DOM 焦点回归（普通网页预览，http 协议）。
 *
 * 只复用受控假平台的注入入口，不改写其运行时规格与 fixture。这里验证 SSR 无法证明的
 * 键盘行为：返回 / Esc 后焦点必须落在仍然挂载的标题上，并且标题随层级更新后仍可继续 Tab。
 *
 * 仍不是真实扩展验收：没有原生权限弹窗、没有真实书签树；stale（缓存降级）在 http
 * 协议下不可用，因此这里不伪造过期状态。
 */

const DESKTOP = { width: 1440, height: 1000 };

function settingsDialog(page: Page) {
  return page.getByRole('dialog', { name: '设置', exact: true });
}

/** 文件夹弹层用内容定位，避免标题随层级变化后 locator 失效。 */
function folderDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]').filter({ hasText: '当前路径：' });
}

function bookmarkRow(page: Page, label: string) {
  return page.getByRole('button', { name: label, exact: true });
}

async function openHome(page: Page) {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  await expect(page.getByRole('main')).toBeVisible();
}

async function openBookmarkPanel(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.getByRole('tab', { name: '收藏夹', exact: true }).click();
  return page.getByRole('tabpanel', { name: '收藏夹', exact: true });
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toBeHidden();
}

async function enableBookmarks(page: Page) {
  const panel = await openBookmarkPanel(page);
  const toggle = panel.getByRole('switch', { name: '启用浏览器收藏夹', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSettings(page);
  await expect(page.locator('[data-bookmark-region]')).toBeVisible();
}

async function switchMode(page: Page, mode: '区域' | '文件夹') {
  const panel = await openBookmarkPanel(page);
  const group = panel.getByRole('group', { name: '主页模式', exact: true });
  const option = group.getByRole('button', { name: mode, exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await closeSettings(page);
}

test('深层返回与 Esc 后焦点落在仍挂载的标题，根层返回全部根也不丢失焦点', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);
  await switchMode(page, '文件夹');

  await bookmarkRow(page, '工作，文件夹，书签栏 / 工作').click();
  const dialog = folderDialog(page);
  const heading = (name: string) => dialog.getByRole('heading', { name, exact: true });
  await expect(heading('工作')).toBeVisible();
  // 打开时的初始焦点保持原有行为（第一个可聚焦控件），本用例只约束层级变化后的焦点。

  // 进入下一层：标题随层级更新，焦点直接落到新标题上。
  await dialog.getByRole('button', { name: '子层，文件夹，书签栏 / 工作 / 子层', exact: true }).click();
  await expect(heading('子层')).toBeVisible();
  await expect(heading('子层')).toBeFocused();

  // Esc 返回「工作」：标题元素仍然挂载，不得落到 body 或已卸载的返回按钮。
  await page.keyboard.press('Escape');
  await expect(heading('工作')).toBeVisible();
  await expect(heading('工作')).toBeFocused();

  // 焦点确实可用：从标题继续 Tab 会进入同一弹层的下一个可聚焦控件（返回按钮）。
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '返回', exact: true })).toBeFocused();

  // 返回按钮回到根层「书签栏」，焦点同样交给标题。
  await page.keyboard.press('Enter');
  await expect(heading('书签栏')).toBeVisible();
  await expect(heading('书签栏')).toBeFocused();

  // 根层 Esc 回到「全部收藏夹」；此处返回按钮已卸载，标题仍在。
  await page.keyboard.press('Escape');
  await expect(heading('全部收藏夹')).toBeVisible();
  await expect(heading('全部收藏夹')).toBeFocused();
  await expect(dialog.getByRole('button', { name: '返回', exact: true })).toHaveCount(0);

  // 顶层再有 Esc 才关闭弹层，焦点归还触发格子而不是留在已卸载标题上。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(bookmarkRow(page, '工作，文件夹，书签栏 / 工作')).toBeFocused();
});
