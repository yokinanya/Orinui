import { expect, test } from '@playwright/test';

test('图标选择显示真实预览，上传与首字母切换后保存正确', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  await page.getByLabel('名称', { exact: true }).fill('哔哩哔哩');
  await page.getByLabel('网址', { exact: true }).fill('https://www.bilibili.com');
  await expect(page.getByRole('img', { name: '名称首字母预览' })).toHaveText('哔');
  const picker = page.getByRole('button', { name: '选择内置图标' });
  await picker.click();
  const heart = page.getByRole('button', { name: '使用爱心图标' });
  await expect(heart.locator('svg')).toBeVisible();
  await heart.click();
  await expect(page.getByRole('img', { name: '内置图形预览' }).locator('svg')).toBeVisible();
  await picker.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.getByLabel('上传图标').setInputFiles({
    name: 'icon.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#37a1b2"/></svg>'),
  });
  await expect(page.getByRole('img', { name: '图标预览', exact: true })).toHaveAttribute('src', /^blob:/);
  await picker.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '使用名称首字母' }).click();
  await expect(page.getByRole('img', { name: '名称首字母预览' })).toHaveText('哔');
  await expect(page.getByRole('img', { name: '图标预览', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const shortcut = page.getByRole('link', { name: '哔哩哔哩', exact: true });
  await expect(shortcut.locator('img, svg')).toHaveCount(0);
  await page.reload();
  await expect(shortcut).toContainText('哔');
  await expect(shortcut.locator('img, svg')).toHaveCount(0);
});

test('横屏编辑采用双列且保存可见，内置图标面板只有图形并支持键盘返回', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/newtab.html');
  await page.getByRole('button', { name: '添加第一个网站' }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站', exact: true });
  const [box, title, preview, save] = await Promise.all([
    dialog.boundingBox(), page.getByLabel('名称', { exact: true }).boundingBox(),
    page.getByRole('img', { name: '名称首字母预览' }).boundingBox(),
    page.getByRole('button', { name: '保存', exact: true }).boundingBox(),
  ]);
  if (!box || !title || !preview || !save) throw new Error('编辑表单未完整显示');
  expect(box.width).toBeGreaterThan(600);
  expect(title.x + title.width).toBeLessThan(preview.x);
  expect(save.y + save.height).toBeLessThanOrEqual(720);
  const picker = page.getByRole('button', { name: '选择内置图标' });
  await picker.focus();
  await page.keyboard.press('Enter');
  const choices = page.getByRole('group', { name: '内置图标', exact: true });
  await expect(choices.getByRole('button')).toHaveCount(6);
  expect(await choices.getByRole('button').allTextContents()).toEqual(['', '', '', '', '', '']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(picker).toBeFocused();
});
