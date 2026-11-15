import { expect, test, type Locator, type Page } from '@playwright/test';

import { openAddMenu } from './form-helpers';

const DRAG_STEPS = 12;
const NARROW_VIEWPORT = { width: 375, height: 812 };

/** 文件夹弹层只有一个，标题随当前层变化，因此用稳定属性定位、用标题断言层级。 */
function folderDialog(page: Page) {
  return page.locator('[data-folder-dialog]');
}

async function expectLevel(page: Page, name: string) {
  const dialog = folderDialog(page);
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  return dialog;
}

async function createFolder(page: Page, name: string) {
  await openAddMenu(page, '新建文件夹');
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  return page.locator('[data-folder-tile]').filter({ hasText: name });
}

/** 在已打开的文件夹弹层里于当前层新建子文件夹。 */
async function createChildFolder(page: Page, container: Locator, name: string) {
  await container.getByRole('button', { name: '新建文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  // 说明文字必须指出新文件夹落在当前层，而不是主页顶层。
  await expect(dialog).toContainText('「');
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  return container.locator('[data-folder-tile]').filter({ hasText: name });
}

async function addWebsite(page: Page, input: { readonly name: string; readonly container?: Locator }) {
  const container = input.container ?? page.getByRole('region', { name: '快捷方式' });
  // 主页网格的新增入口在右下角「添加」菜单；文件夹弹层里仍是自己的添加按钮。
  if (input.container) await container.getByRole('button', { name: /添加(第一个)?网站/, exact: true }).click();
  else await openAddMenu(page, '添加网站');
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
  // 文案必须说明「只删这一层、不级联、追加到父层末尾、不重排」。
  await expect(confirmation).toContainText('不会连带删除里面的内容');
  await expect(confirmation).toContainText('按原相对顺序追加到');
  await expect(confirmation).toContainText('原有内容不移动');
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
  const folder = await expectLevel(page, '工作');
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
  await expectLevel(page, '工作资料');
});

test('文件夹添加、移出与删除后的内容刷新，删除文件夹保留网站并返回主页', async ({ page }) => {
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '收藏');
  await tile.click();
  const folder = await expectLevel(page, '收藏');
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
  await expect.poll(() => folder.evaluate((element) => element.contains(document.activeElement))).toBe(true);
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
  const folder = await expectLevel(page, '窄屏文件夹');
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

test('混合网格中整块网站拖到占用格位，同列下推且持久化位置', async ({ page }) => {
  await page.goto('/newtab.html');
  await addWebsite(page, { name: 'first' });
  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await addWebsite(page, { name: 'second' });
  await createFolder(page, '独立文件夹');
  const home = page.getByRole('region', { name: '快捷方式' });
  const first = home.locator('[data-home-item]').filter({ hasText: 'first' });
  const second = home.locator('[data-home-item]').filter({ hasText: 'second' });
  await first.hover();
  // 整张卡片即拖拽手柄，从条目中心按下即可拖动。
  await drag(page, { source: first,
    target: home.locator('[data-home-cell="0:1"]') });
  await expect(first).toHaveCSS('grid-column-start', '2');
  await expect(first).toHaveCSS('grid-row-start', '1');
  await expect(second).toHaveCSS('grid-column-start', '2');
  await expect(second).toHaveCSS('grid-row-start', '2');
  await page.reload();
  await expect(first).toHaveCSS('grid-column-start', '2');
  await expect(first).toHaveCSS('grid-row-start', '1');
  await expect(second).toHaveCSS('grid-row-start', '2');
  await expect(home.getByRole('link')).toHaveCount(2);
  await expect(home.locator('[data-folder-tile]')).toHaveText(['独立文件夹']);
});

test('固定文件夹不被网站移动挤开：键盘放下时明确报错且位置不变', async ({ page }) => {
  await page.goto('/newtab.html');
  await addWebsite(page, { name: 'solo' });
  await addWebsite(page, { name: 'other' });
  await createFolder(page, '固定');
  const home = page.getByRole('region', { name: '快捷方式' });
  // 格位按创建顺序追加空位：solo 0:0、other 0:1，文件夹最后创建落在 1:0。
  await expect(home.locator('[data-home-item]')).toHaveCount(3);
  // `has` 的内层定位符相对外层条目解析；用根定位符（home.locator）会把祖先链也当成
  // 条目内部必须存在的节点，永远匹配不到。这里用文档根的选择器，只匹配条目子树里的文件夹格子。
  const folderItem = home.locator('[data-home-item]').filter({ has: page.locator('[data-folder-tile]') });
  const solo = home.locator('[data-home-item]').filter({ hasText: 'solo' });
  const other = home.locator('[data-home-item]').filter({ hasText: 'other' });
  await expect(folderItem).toHaveAttribute('data-home-row', '1');
  await expect(folderItem).toHaveAttribute('data-home-column', '0');
  await expect(solo).toHaveAttribute('data-home-row', '0');
  await expect(solo).toHaveAttribute('data-home-column', '0');
  await expect(other).toHaveAttribute('data-home-column', '1');

  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  // 键盘把 solo 移到文件夹格位后放下：守卫必须拒绝，而不是把固定文件夹挤到下一行。
  await solo.focus();
  await solo.press('Space');
  await solo.press('ArrowDown');
  await solo.press('Space');
  await expect(page.getByText('操作未完成', { exact: true })).toBeVisible();
  await expect(page.getByText('文件夹位置固定，不能把其他内容放到文件夹格位上', { exact: true })).toBeVisible();
  await expect(folderItem).toHaveAttribute('data-home-row', '1');
  await expect(folderItem).toHaveAttribute('data-home-column', '0');
  await expect(solo).toHaveAttribute('data-home-row', '0');
  await expect(solo).toHaveAttribute('data-home-column', '0');

  await page.reload();
  // 刷新后仍是原位置：拒绝没有产生部分写入。
  const reloadedHome = page.getByRole('region', { name: '快捷方式' });
  await expect(reloadedHome.locator('[data-folder-tile]')).toHaveText(['固定']);
  await expect(reloadedHome.locator('[data-home-item]').filter({ has: page.locator('[data-folder-tile]') }))
    .toHaveAttribute('data-home-row', '1');
  await expect(reloadedHome.locator('[data-home-item]').filter({ hasText: 'solo' }))
    .toHaveAttribute('data-home-row', '0');
  await expect(reloadedHome.locator('[data-home-item]').filter({ hasText: 'other' }))
    .toHaveAttribute('data-home-row', '0');
});

test('文件夹格子是静态块：编辑模式没有位置按钮、菜单没有上下移动，拖动也不改变顺序', async ({ page }) => {
  await page.goto('/newtab.html');
  await createFolder(page, '工作');
  const reading = await createFolder(page, '阅读');
  const home = page.getByRole('region', { name: '快捷方式' });
  const tiles = home.locator('[data-folder-tile]');
  await expect(tiles).toHaveText(['工作', '阅读']);

  await page.getByRole('button', { name: '整理主页', exact: true }).click();
  await expect(home.locator('[data-home-item]').filter({ hasText: '工作' })).toHaveAttribute('data-home-static', 'true');
  await keyboardMenu(page, home.locator('[data-folder-tile]').filter({ hasText: '工作' }));
  await expect(page.getByRole('menuitem', { name: '上移', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: '下移', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 鼠标把「阅读」拖到「工作」上，不应触发任何文件夹重排。
  const work = home.locator('[data-home-item]').filter({ hasText: '工作' });
  await drag(page, { source: reading, target: work });
  await expect(tiles).toHaveText(['工作', '阅读']);
  await page.reload();
  await expect(tiles).toHaveText(['工作', '阅读']);
});

test('嵌套文件夹只在父层出现，可逐层进入并按面包屑返回，主页只保留顶层', async ({ page }) => {
  await page.goto('/newtab.html');
  const rootTile = await createFolder(page, '工作');
  await rootTile.click();
  const dialog = await expectLevel(page, '工作');

  const childTile = await createChildFolder(page, dialog, '项目');
  await expect(dialog.locator('[data-folder-tile]')).toHaveText(['项目']);
  await childTile.click();
  await expectLevel(page, '项目');
  // 路径从「主页」起算，和搜索结果、视觉规格一致。
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作/项目');

  const grandChildTile = await createChildFolder(page, dialog, '归档');
  await grandChildTile.click();
  await expectLevel(page, '归档');
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作/项目/归档');

  // Esc 关闭整层后回到主页；嵌套文件夹不出现在主页格位上。
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-folder-tile]')).toHaveText(['工作']);
  await page.reload();
  await expect(page.locator('[data-folder-tile]')).toHaveText(['工作']);

  // 重新进入后逐层返回，焦点回到刚进入的子文件夹格子。
  const rootEntry = page.locator('[data-folder-tile]').filter({ hasText: '工作' });
  const rootId = await rootEntry.getAttribute('data-folder-id');
  expect(rootId).not.toBeNull();
  await rootEntry.click();
  await expectLevel(page, '工作');
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作');
  // 读取成功后弹层状态必须是 ready；加载中或失败时不会渲染层级内容。
  await expect(dialog).toHaveAttribute('data-folder-state', 'ready');
  await expect(dialog).toHaveAttribute('data-folder-level', rootId!);
  const projectTile = dialog.locator('[data-folder-tile]').filter({ hasText: '项目' });
  const projectId = await projectTile.getAttribute('data-folder-id');
  expect(projectId).not.toBeNull();
  await projectTile.click();
  await expectLevel(page, '项目');
  // 进入子层后 data-folder-level 指向当前层，而不是仍停在父层。
  await expect(dialog).toHaveAttribute('data-folder-level', projectId!);
  await dialog.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expectLevel(page, '工作');
  await expect(dialog).toHaveAttribute('data-folder-level', rootId!);
  await expect.poll(() => dialog.locator('[data-folder-id]').first().evaluate((element) => element === document.activeElement))
    .toBe(true);

  // 面包屑可回到任意祖先。
  await dialog.locator('[data-folder-tile]').filter({ hasText: '项目' }).click();
  await expectLevel(page, '项目');
  await dialog.locator('[data-folder-tile]').filter({ hasText: '归档' }).click();
  await expectLevel(page, '归档');
  await dialog.getByRole('navigation', { name: '文件夹路径' }).getByRole('button', { name: '工作', exact: true }).click();
  await expectLevel(page, '工作');
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作');

  // 主页入口：点击路径起点的「主页」即关闭文件夹弹层回到主页。
  await dialog.getByRole('navigation', { name: '文件夹路径' }).getByRole('button', { name: '主页', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-folder-tile]')).toHaveText(['工作']);
});

test('当前层新建文件夹与网站，空文件夹给出创建入口', async ({ page }) => {
  await page.goto('/newtab.html');
  const rootTile = await createFolder(page, '工作');
  await rootTile.click();
  const dialog = await expectLevel(page, '工作');
  await expect(dialog).toContainText('这个文件夹是空的');
  // 只有读取成功且确实为空时才显示空状态，不能把加载中或失败冒充成空文件夹。
  await expect(dialog).toHaveAttribute('data-folder-state', 'ready');
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作');

  const childTile = await createChildFolder(page, dialog, '子项');
  const childId = await childTile.getAttribute('data-folder-id');
  expect(childId).not.toBeNull();
  await addWebsite(page, { name: 'inside', container: dialog });
  await expect(dialog).toContainText('1 个网站');
  await expect(dialog).toContainText('1 个文件夹');
  await expect(dialog.getByRole('link', { name: 'inside', exact: true })).toBeVisible();

  // 当前层的新建内容不出现在主页网格上：主页只有顶层「工作」。
  await page.keyboard.press('Escape');
  const home = page.getByRole('region', { name: '快捷方式' });
  await expect(home.getByRole('link', { name: 'inside', exact: true })).toHaveCount(0);
  await expect(home.locator('[data-folder-tile]')).toHaveText(['工作']);
  await expect(home.locator(`[data-folder-id="${childId}"]`)).toHaveCount(0);

  // 重新进入仍落在同一父层，子文件夹身份不变。
  await page.locator('[data-folder-tile]').filter({ hasText: '工作' }).click();
  await expectLevel(page, '工作');
  await expect(dialog.locator('[data-folder-tile]').filter({ hasText: '子项' }))
    .toHaveAttribute('data-folder-id', childId!);
});

test('删除文件夹只提升直接子项：追加到父层末尾，既有项与深层子树保持，不级联不重编号', async ({ page }) => {
  await page.goto('/newtab.html');
  const rootTile = await createFolder(page, '工作');
  await rootTile.click();
  const dialog = await expectLevel(page, '工作');
  // 父层既有项：两个网站与一个同级文件夹，删除后必须原位保留在前。
  await addWebsite(page, { name: 'doc', container: dialog });
  await addWebsite(page, { name: 'keep', container: dialog });
  await createChildFolder(page, dialog, '既有');

  const childTile = await createChildFolder(page, dialog, '项目');
  await childTile.click();
  await expectLevel(page, '项目');
  // 被删层的直接子项：网站 deep、文件夹 归档；deep 的相对顺序在 归档 之前。
  await addWebsite(page, { name: 'deep', container: dialog });
  const grandChildTile = await createChildFolder(page, dialog, '归档');
  const archiveId = await grandChildTile.getAttribute('data-folder-id');
  expect(archiveId).not.toBeNull();
  await grandChildTile.click();
  await expectLevel(page, '归档');
  await addWebsite(page, { name: 'archived', container: dialog });

  // 回到「工作」层，从子文件夹菜单删除「项目」。
  await dialog.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expectLevel(page, '项目');
  await dialog.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expectLevel(page, '工作');
  const existingId = await dialog.locator('[data-folder-tile]').filter({ hasText: '既有' }).getAttribute('data-folder-id');
  await keyboardMenu(page, dialog.locator('[data-folder-tile]').filter({ hasText: '项目' }));
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('不会连带删除里面的内容');
  await expect(confirmation).toContainText('1 个网站');
  await expect(confirmation).toContainText('1 个子文件夹');
  await expect(confirmation).toContainText('更深层的 1 个网站继续留在子文件夹里');
  await expect(confirmation).toContainText('追加到');
  await expect(confirmation).toContainText('原有内容不移动');
  await confirmation.getByRole('button', { name: '删除文件夹', exact: true }).click();
  await expect(confirmation).toBeHidden();

  // 直接子项追加到父层末尾：既有文件夹「既有」在前，「归档」在后。
  await expectLevel(page, '工作');
  const promoted = dialog.locator('[data-folder-tile]');
  await expect(promoted).toHaveText(['既有', '归档']);
  // 提升不重新编号身份：既有项保留原 ID，归档沿用被删子项的 ID，只是换了父层。
  await expect(promoted.first()).toHaveAttribute('data-folder-id', existingId ?? '');
  await expect(promoted.last()).toHaveAttribute('data-folder-id', archiveId!);
  // 网站同理：既有 doc、keep 原位保留，deep 追加在末尾。
  // 格子里的首字母头像带 aria-hidden，但仍留在 textContent 里（"Ddoc"）；名称通道用可访问名称。
  const promotedLinks = dialog.getByRole('link');
  await expect(promotedLinks).toHaveCount(3);
  for (const [index, name] of ['doc', 'keep', 'deep'].entries()) {
    await expect(promotedLinks.nth(index)).toHaveAccessibleName(name);
  }

  // 深层子树完整保留：进入「归档」仍能看到原内容，路径也正确。
  await promoted.last().click();
  await expectLevel(page, '归档');
  await expect(dialog).toHaveAttribute('data-folder-level', archiveId!);
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作/归档');
  await expect(dialog.getByRole('link', { name: 'archived', exact: true })).toBeVisible();
});

test('网站移动到文件夹的菜单用完整路径区分同名文件夹', async ({ page }) => {
  await page.goto('/newtab.html');
  // 顶层「项目」与「工作/项目」同名：菜单必须给出完整路径，否则无法区分。
  await createFolder(page, '项目');
  const rootTile = await createFolder(page, '工作');
  await rootTile.click();
  const dialog = await expectLevel(page, '工作');
  await createChildFolder(page, dialog, '项目');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await addWebsite(page, { name: '站点' });
  const home = page.getByRole('region', { name: '快捷方式' });
  await keyboardMenu(page, home.getByRole('link', { name: '站点', exact: true }));
  await page.getByRole('menuitem', { name: '移动到文件夹', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '工作 / 项目', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '工作 / 项目', exact: true }).click();

  // 移入嵌套层后主页不再显示，嵌套层里能看到。
  await expect(home.getByRole('link', { name: '站点', exact: true })).toHaveCount(0);
  await page.locator('[data-folder-tile]').filter({ hasText: '工作' }).click();
  await expectLevel(page, '工作');
  await dialog.locator('[data-folder-tile]').filter({ hasText: '项目' }).click();
  await expectLevel(page, '项目');
  await expect(dialog.getByRole('link', { name: '站点', exact: true })).toBeVisible();
});

test('搜索建议打开嵌套文件夹时显示完整路径', async ({ page }) => {
  await page.goto('/newtab.html');
  const rootTile = await createFolder(page, '工作');
  await rootTile.click();
  const dialog = await expectLevel(page, '工作');
  await createChildFolder(page, dialog, '阅读');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('阅读');
  await page.getByRole('option', { name: /打开文件夹「阅读」/ }).click();
  await expectLevel(page, '阅读');
  // 从搜索结果直接进入深层时，面包屑仍要给出完整路径，而不是只显示当前层名称。
  await expect(dialog.getByRole('navigation', { name: '文件夹路径' })).toHaveText('主页/工作/阅读');
  await expect(page.getByRole('dialog')).toHaveCount(1);
});
