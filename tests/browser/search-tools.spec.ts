import { expect, test } from '@playwright/test';

test('搜索框提供本地计算、换算、GitHub 编号和引擎搜索', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const search = page.getByRole('textbox', { name: '搜索' });

  await search.fill('=2*(3+4)');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('14');
  await search.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('14');

  await search.fill('10 MiB to MB');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('10.48576');
  await search.fill('2026-10-16T09:00:00+08:00 to UTC');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('2026-10-16 01:00:00 UTC');

  await page.context().route('https://github.com/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
  await search.fill('gh owner/repo#123');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('打开 GitHub Issue 或 PR');
  await search.press('Enter');
  await expect(page).toHaveURL('https://github.com/owner/repo/issues/123');
});

test('普通文字仍使用可切换的当前搜索引擎', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '选择搜索引擎' }).click();
  await page.getByRole('menuitemradio', { name: 'Bing' }).click();
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索' }).fill('普通查询');
  await expect(page.getByRole('listbox').getByRole('option').last()).toContainText('用 Bing 搜索');
});

test('搜索引擎菜单支持键盘操作并使用应用弹层样式', async ({ page }) => {
  await page.goto('/newtab.html');
  const picker = page.getByRole('button', { name: '选择搜索引擎' });
  await picker.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/bg-popover/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('title', '搜索引擎：Bing');
  await expect(picker).toHaveText('');
});

test('图标入口在输入框左侧，结果和键盘提示区分操作', async ({ page }) => {
  await page.goto('/newtab.html');
  const picker = page.getByRole('button', { name: '选择搜索引擎' });
  const input = page.getByRole('textbox', { name: '搜索' });
  const pickerBox = await picker.boundingBox();
  const inputBox = await input.boundingBox();
  expect(pickerBox!.x).toBeLessThan(inputBox!.x);
  await expect(picker.locator('svg')).toHaveCount(1);
  await input.fill('12 * 8');
  await expect(page.getByRole('option').first()).toContainText('96');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('快捷工具', { exact: true })).toBeVisible();
  await expect(page.getByText('网页搜索', { exact: true })).toBeVisible();
  await input.fill('普通文字');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option').first()).toContainText('搜索');
});
