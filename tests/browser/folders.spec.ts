import { expect, test, type Locator, type Page } from '@playwright/test';

const DRAG_STEPS = 12;
const NARROW_VIEWPORT = { width: 375, height: 812 };

async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  return page.locator('[data-folder-tile]').filter({ hasText: name });
}

async function addWebsite(page: Page, input: { readonly name: string; readonly container?: Locator }) {
  const container = input.container ?? page.getByRole('region', { name: '快捷方式' });
  await container.getByRole('button', { name: /添加(第一个)?网站/, exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站', exact: true });
  await form.getByLabel('名称', { exact: true }).fill(input.name);
  await form.getByLabel('网址', { exact: true }).fill(`${input.name}.example.com`);
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  await expect(container.getByText(input.name, { exact: true })).toBeVisible();
}

async function keyboardMenu(page: Page, target: Locator) {
  await target.focus();
  await target.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
}

async function moveTo(page: Page, input: { readonly shortcut: Locator; readonly name: string }) {
  await keyboardMenu(page, input.shortcut);
  await page.getByRole('menuitem', { name: '移动到文件夹', exact: true }).hover();
  await page.getByRole('menuitem', { name: input.name, exact: true }).click();
}

async function deleteFolder(page: Page, tile: Locator) {
  await keyboardMenu(page, tile);
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('网站会回到主页网格，不会被删除');
  await confirmation.getByRole('button', { name: '删除文件夹', exact: true }).click();
  await expect(confirmation).toBeHidden();
}

async function drag(page: Page, input: { readonly source: Locator; readonly target: Locator }) {
  const source = await input.source.boundingBox();
  const target = await input.target.boundingBox();
  if (!source || !target) throw new Error('拖动目标未显示');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: DRAG_STEPS });
  await page.mouse.up();
}

test('文件夹在主页网格创建、键盘打开和重命名，刷新保持且不出现顶部分组', async ({ page }) => {
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '工作');
  await expect(page.getByRole('navigation', { name: '分组' })).toHaveCount(0);
  await keyboardMenu(page, tile);
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).press('Enter');
  const folder = page.getByRole('dialog', { name: '工作', exact: true });
  await expect(folder).toContainText('0 个网站');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await keyboardMenu(page, tile);
  await page.getByRole('menuitem', { name: '重命名', exact: true }).press('Enter');
  const rename = page.getByRole('dialog', { name: '重命名文件夹', exact: true });
  await rename.getByLabel('文件夹名称', { exact: true }).fill('工作资料');
  await rename.getByRole('button', { name: '保存', exact: true }).click();
  await expect(rename).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-folder-tile]')).toHaveText(['工作资料']);
  await page.locator('[data-folder-tile]').click();
  await expect(page.getByRole('dialog', { name: '工作资料', exact: true })).toBeVisible();
});

test('文件夹添加、移出与删除后的内容刷新，删除文件夹保留网站并返回主页', async ({ page }) => {
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '收藏');
  await tile.click();
  const folder = page.getByRole('dialog', { name: '收藏', exact: true });
  await addWebsite(page, { name: 'inside', container: folder });
  await addWebsite(page, { name: 'keep', container: folder });
  await expect(folder).toContainText('2 个网站');
  await moveTo(page, { shortcut: folder.getByRole('link', { name: 'inside', exact: true }), name: '主页' });
  await expect(folder.getByRole('link', { name: 'inside', exact: true })).toHaveCount(0);
  await expect(folder).toContainText('1 个网站');
  await page.keyboard.press('Escape');
  const home = page.getByRole('region', { name: '快捷方式' });
  await expect(home.getByRole('link', { name: 'inside', exact: true })).toBeVisible();
  await moveTo(page, { shortcut: home.getByRole('link', { name: 'inside', exact: true }), name: '收藏' });
  await expect(home.getByRole('link', { name: 'inside', exact: true })).toHaveCount(0);
  await tile.click();
  await expect(folder.getByRole('link')).toHaveCount(2);
  await keyboardMenu(page, folder.getByRole('link', { name: 'inside', exact: true }));
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(folder.getByRole('link')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(folder).toBeHidden();
  await tile.click();
  await expect(folder.getByRole('link')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await deleteFolder(page, tile);
  await expect(home.getByRole('link', { name: 'keep', exact: true })).toBeVisible();
  await expect(page.locator('[data-folder-tile]')).toHaveCount(0);
  await page.reload();
  await expect(home.getByRole('link', { name: 'keep', exact: true })).toBeVisible();
});

test('窄屏文件夹与网站共享网格，弹层留在视口内且可通过键盘操作网站排序', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '窄屏文件夹');
  await tile.click();
  const folder = page.getByRole('dialog', { name: '窄屏文件夹', exact: true });
  await addWebsite(page, { name: 'first', container: folder });
  await addWebsite(page, { name: 'second', container: folder });
  const actions = folder.getByRole('button', { name: 'first 的操作', exact: true });
  await actions.focus();
  await actions.press('Enter');
  await expect(page.getByRole('menuitem', { name: '上移', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: '下移', exact: true }).press('Enter');
  await expect(folder.getByRole('link').first()).toHaveAccessibleName('second');
  await expect(folder.getByRole('link').last()).toHaveAccessibleName('first');
  const box = await folder.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW_VIEWPORT.width);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '分组' })).toHaveCount(0);
});

test('混合网格中网站拖动使用相同 sortable 标识并持久化次序', async ({ page }) => {
  await page.goto('/newtab.html');
  await addWebsite(page, { name: 'first' });
  await page.getByRole('button', { name: '编辑网站', exact: true }).click();
  await addWebsite(page, { name: 'second' });
  await createFolder(page, '独立文件夹');
  const home = page.getByRole('region', { name: '快捷方式' });
  await drag(page, { source: home.getByText('first', { exact: true }), target: home.getByText('second', { exact: true }) });
  await expect(home.locator('.shortcut-grid > li').nth(1)).toContainText('second');
  await page.reload();
  await expect(home.getByRole('link').first()).toHaveAccessibleName('second');
  await expect(home.locator('[data-folder-tile]')).toHaveText(['独立文件夹']);
});

test('文件夹菜单上下移动持久化，搜索建议复用同一个文件夹弹层', async ({ page }) => {
  await page.goto('/newtab.html');
  const first = await createFolder(page, '工作');
  await createFolder(page, '阅读');
  await keyboardMenu(page, first);
  await page.getByRole('menuitem', { name: '下移', exact: true }).press('Enter');
  await expect(page.locator('[data-folder-tile]')).toHaveText(['阅读', '工作']);
  await page.reload();
  await expect(page.locator('[data-folder-tile]')).toHaveText(['阅读', '工作']);
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('工作');
  await page.getByRole('option', { name: /打开文件夹「工作」/ }).click();
  await expect(page.getByRole('dialog', { name: '工作', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: '搜索结果' })).toBeHidden();
  await first.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});
