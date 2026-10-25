import { expect, test, type Page } from '@playwright/test';
import { openAddMenu } from './form-helpers';

const WIDE_VIEWPORT = { width: 1440, height: 900 };

async function addShortcut(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '添加第一个网站', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加网站' });
  await dialog.getByLabel('名称', { exact: true }).fill(name);
  await dialog.getByLabel('网址', { exact: true }).fill('example.com');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden' });
}

async function addFolder(page: Page, name: string): Promise<void> {
  await openAddMenu(page, '新建文件夹');
  const dialog = page.getByRole('dialog', { name: '新建文件夹' });
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden' });
}

test('搜索 Escape 先收起建议再清空关键词', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.click();
  await input.fill('示例');
  const list = page.getByRole('listbox', { name: '搜索结果' });
  await expect(list).toBeVisible();

  await input.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(input).toHaveValue('示例');
  await expect(input).toBeFocused();

  await input.press('Escape');
  await expect(input).toHaveValue('');
});

test('点击文件夹格子打开弹层并在其中添加网站', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await addFolder(page, '工作');
  await page.getByRole('button', { name: '工作', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '工作' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '添加网站', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站' });
  await form.getByLabel('名称', { exact: true }).fill('文档');
  await form.getByLabel('网址', { exact: true }).fill('example.com');
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: 'hidden' });

  await expect(dialog.getByRole('link', { name: '文档' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 文件夹里的网站不出现在主页网格上。
  await expect(page.locator('[data-shortcut-frame] a', { hasText: '文档' })).toHaveCount(0);
});

test('删除文件夹后其中的网站回到主页网格', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await addFolder(page, '工作');
  await page.getByRole('button', { name: '工作', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作' });
  await dialog.getByRole('button', { name: '添加网站', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站' });
  await form.getByLabel('名称', { exact: true }).fill('文档');
  await form.getByLabel('网址', { exact: true }).fill('example.com');
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');

  // 文件夹通过右键菜单管理；未进入编辑模式时也可操作。
  await page.getByRole('button', { name: '工作', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除文件夹', exact: true }).click();

  await expect(page.getByRole('button', { name: '工作', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '文档', exact: true })).toBeVisible();
});

test('编辑模式点击空白处退出，点击格子与右键菜单不退出', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto('/newtab.html');
  await addShortcut(page, '格子站点');
  const finish = page.locator('button[aria-pressed]').first();
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect(finish).toHaveAttribute('aria-pressed', 'true');

  // 点击格子条目仍不应退出编辑。
  await page.locator('[data-home-item]').first().click();
  await expect(finish).toHaveAttribute('aria-pressed', 'true');

  await page.locator('main').click({ position: { x: 6, y: 6 } });
  await expect(finish).toHaveAttribute('aria-pressed', 'false');
  await expect(finish).toHaveAccessibleName('整理主页');
});