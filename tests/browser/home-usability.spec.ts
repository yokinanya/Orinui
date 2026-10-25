import { expect, test } from '@playwright/test';
import { addHomeWidget } from './form-helpers';

test('新增聚焦、编辑不跳页、键盘移动与取消、右下角手柄可调高', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/newtab.html');
  await expect(page.getByRole('button', { name: '新建文件夹', exact: true })).toHaveCount(0);
  await addHomeWidget(page, '便签');
  await expect(page.getByLabel('便签内容')).toBeFocused();
  await page.getByLabel('便签内容').fill('无需失焦也保存');
  await expect(page.getByRole('region', { name: '便签', exact: true }).getByRole('status')).toBeEmpty();
  await page.reload();
  await expect(page.getByLabel('便签内容')).toHaveValue('无需失焦也保存');
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect(page.locator('[data-home-item] [data-home-resize]')).toBeVisible();
  const card = page.locator('[data-home-item]').first();
  await card.focus();
  await card.press('Space');
  await card.press('ArrowRight');
  await card.press('Space');
  await expect(card).toHaveAttribute('data-home-column', '1');
  await card.press('Space');
  await card.press('ArrowDown');
  await card.press('Escape');
  await expect(card).toHaveAttribute('data-home-row', '0');
  const input = page.getByLabel('便签内容');
  await input.focus();
  await input.press('ArrowLeft');
  await expect(card).toHaveAttribute('data-home-column', '1');
  await page.reload();
  await expect(card).toHaveAttribute('data-home-column', '1');
});

test('长页进入整理与取消整理保持视口位置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/newtab.html');
  for (let index = 0; index < 6; index += 1) await addHomeWidget(page, '便签');
  await expect(page.getByLabel('便签内容').last()).toBeFocused();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
