import { expect, type Page } from '@playwright/test';

/** Match the visible form submission action, not an image URL's adjacent save button. */
export function visibleSubmitButton(page: Page) {
  return page.locator('button[type="submit"]:visible').last();
}

/** 主页新增网站与小组件统一收在右下角「添加」菜单里。用 aria-label 定位，避免撞上待办表单的「添加」按钮。 */
export async function openAddMenu(page: Page, item?: '添加网站' | '添加便签' | '添加待办' | '新建文件夹') {
  await page.getByRole('button', { name: '添加', exact: true }).and(page.locator('[aria-haspopup="menu"]')).click();
  if (!item) return;
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** 添加小组件后断言条目数量增加，避免在挂载完成前断言内容。 */
export async function addHomeWidget(page: Page, kind: '便签' | '待办') {
  const before = await page.locator('[data-home-item]').count();
  await openAddMenu(page, `添加${kind}`);
  await expect(page.locator('[data-home-item]')).toHaveCount(before + 1);
  await expect(page.getByRole('region', { name: kind, exact: true }).last()).toBeVisible();
}
