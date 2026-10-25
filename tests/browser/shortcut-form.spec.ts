import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openAddMenu } from './form-helpers';

test.setTimeout(60_000);

test('连续添加清空网站、图片和下载状态，普通保存仍关闭', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('第一站');
  await dialog.getByLabel('网址', { exact: true }).fill('https://first.example.com');
  await page.getByLabel('选择图标文件').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml',
    buffer: await readFile(new URL('../fixtures/x.svg', import.meta.url)) });
  await expect(dialog.getByRole('img', { name: '图标预览', exact: true })).toHaveAttribute('src', /^blob:/);
  await dialog.getByLabel('自定义图片URL', { exact: true }).fill('invalid-source');
  await dialog.locator('[data-slot="input-group-addon"] button').click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: '保存并继续添加', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('网址', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('网址', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('自定义图片URL', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('img', { name: '图标预览', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选择图标文件')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '使用名称首字母', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('名称', { exact: true }).fill('第二站');
  await dialog.getByLabel('网址', { exact: true }).fill('https://second.example.com');
  await dialog.locator('button[type="submit"]').filter({ hasText: /^保存$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: '第一站', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '第二站', exact: true })).toBeVisible();
});

test('网站实时预览在桌面并列，在手机纵向排列', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  const name = page.getByLabel('名称', { exact: true });
  const preview = page.getByLabel('网站实时预览', { exact: true });
  await name.fill('实时网站');
  await expect(preview).toContainText('实时网站');
  const desktopName = await name.boundingBox();
  const desktopPreview = await preview.boundingBox();
  expect(desktopPreview!.x).toBeGreaterThan(desktopName!.x + desktopName!.width);
  await page.setViewportSize({ width: 375, height: 812 });
  const mobileName = await name.boundingBox();
  const mobilePreview = await preview.boundingBox();
  expect(mobilePreview!.y).toBeGreaterThan(mobileName!.y + mobileName!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('连续添加保留文件夹目的地，编辑模式不提供连续添加', async ({ page }) => {
  await page.goto('/newtab.html');
  await openAddMenu(page, '新建文件夹');
  const create = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await create.getByLabel('文件夹名称', { exact: true }).fill('收藏夹');
  await create.getByRole('button', { name: '创建', exact: true }).click();
  await expect(create).toBeHidden();
  await page.locator('[data-folder-tile]').filter({ hasText: '收藏夹' }).click();
  const folder = page.getByRole('dialog', { name: '收藏夹', exact: true });
  await folder.getByRole('button', { name: '添加网站', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站', exact: true });
  await form.getByLabel('名称', { exact: true }).fill('文件夹一');
  await form.getByLabel('网址', { exact: true }).fill('https://first.example.com');
  await form.getByRole('button', { name: '保存并继续添加', exact: true }).click();
  await expect(form.getByLabel('网址', { exact: true })).toHaveValue('');
  await form.getByLabel('名称', { exact: true }).fill('文件夹二');
  await form.getByLabel('网址', { exact: true }).fill('https://second.example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  const first = folder.getByRole('link', { name: '文件夹一', exact: true });
  await expect(first).toBeVisible();
  await expect(folder.getByRole('link', { name: '文件夹二', exact: true })).toBeVisible();
  await first.focus();
  await first.press('Shift+F10');
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑网站', exact: true });
  await expect(edit.getByRole('button', { name: '保存并继续添加', exact: true })).toHaveCount(0);
});
