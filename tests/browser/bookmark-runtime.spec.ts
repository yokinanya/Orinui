import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  BOOKMARK_SECRET_URL,
  emitBookmarkPermission,
  installBookmarkPlatform,
  openedBookmarkUrls,
  persistBookmarkPermission,
  platformCounts,
  readBookmarkPreferences,
  readBookmarkRules,
  requestPhases,
  seedBookmarkPreferences,
  setBookmarkOpenFailure,
} from './bookmark-runtime-fixtures';

/**
 * 受控假平台下的浏览器收藏夹接线回归（普通网页预览，http 协议）。
 *
 * 这些用例真正挂载 React 组件并点击界面，覆盖纯函数/SSR 测试覆盖不到的接线：
 * 授权手势、整树两模式渲染、布局隐藏后的唯一弹层宿主、撤销门控与打开失败反馈。
 *
 * 它们**不是**真实扩展验收：假 `browser` 由 `bookmark-runtime-fixtures.ts` 在 bundle
 * 之前注入，没有原生权限弹窗、没有真实书签树，也不读取用户 profile。http 协议下
 * 产品缓存按设计不可用，因此「书签缓存…失败」是必须如实期待的提示；本文件不伪造
 * stale 降级、缓存写入成功或清缓存成功。
 */

const DESKTOP = { width: 1440, height: 1000 };
const FOLDER_DIALOG_TEXT = '当前路径：';

function settingsDialog(page: Page) {
  return page.getByRole('dialog', { name: '设置', exact: true });
}

function bookmarkSection(page: Page) {
  return page.getByRole('region', { name: '浏览器收藏夹', exact: true });
}

function bookmarkRegion(page: Page) {
  return page.locator('[data-bookmark-region]');
}

/** 文件夹弹层用内容定位，避免标题随层级变化后 locator 失效。 */
function folderDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]').filter({ hasText: FOLDER_DIALOG_TEXT });
}

function searchBox(page: Page) {
  return page.getByRole('textbox', { name: '搜索', exact: true });
}

function results(page: Page) {
  return page.getByRole('listbox', { name: '搜索结果', exact: true });
}

/** 书签结果按 label 开头锁定，避免被同查询词的「用 … 搜索」项命中。 */
function bookmarkOption(page: Page, label: string): Locator {
  return results(page).getByRole('option').filter({ hasText: new RegExp(`^${label}`, 'u') });
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

function enableSwitch(panel: Locator) {
  return panel.getByRole('switch', { name: '启用浏览器收藏夹', exact: true });
}

/** 显式点击启用；权限请求必须与这次点击处于同一个任务内。 */
async function enableBookmarks(page: Page) {
  const panel = await openBookmarkPanel(page);
  const toggle = enableSwitch(panel);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSettings(page);
  await expect(bookmarkRegion(page)).toBeVisible();
}

async function switchMode(page: Page, mode: '区域' | '文件夹') {
  const panel = await openBookmarkPanel(page);
  const group = panel.getByRole('group', { name: '主页模式', exact: true });
  const option = group.getByRole('button', { name: mode, exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await closeSettings(page);
}

async function hideBookmarkRegion(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '布局', exact: true }).click();
  const layout = page.getByRole('tabpanel', { name: '布局', exact: true });
  await layout.getByRole('switch', { name: '显示浏览器收藏夹', exact: true }).click();
  await closeSettings(page);
}

test('默认不读书签：只在点击启用后的同任务内请求权限，授权后才 getTree', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);

  // 默认关闭：启动阶段既不查权限也不读树。
  expect(await platformCounts(page)).toEqual({
    request: 0, contains: 0, getTree: 0, tabsCreate: 0, tabsQuery: 0, tabsUpdate: 0,
  });

  const panel = await openBookmarkPanel(page);
  // 普通 http 预览没有扩展存储，首次清理缓存就应失败；不把它演成成功。
  await expect(panel.getByText(/书签缓存清除失败/u)).toBeVisible();
  expect((await platformCounts(page)).request).toBe(0);
  expect((await platformCounts(page)).getTree).toBe(0);

  const toggle = enableSwitch(panel);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // 点击捕获阶段即发起 request（同一任务），随后才 contains/getTree。
  // 授权事件与启用流程都可能触发一次重读，因此不把 getTree 固定在 1 次，
  // 只要求「请求恰好一次权限」且「确实读过整棵树」。
  await expect.poll(() => platformCounts(page)).toMatchObject({ request: 1 });
  await expect.poll(async () => (await platformCounts(page)).getTree).toBeGreaterThanOrEqual(1);
  expect(await requestPhases(page)).toEqual(['capture']);
  await expect(panel.getByText(/书签缓存保存失败/u)).toBeVisible();

  await closeSettings(page);
  await expect(bookmarkRegion(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: '书签栏', exact: true })).toBeVisible();

  // 授权事件与启用流程都可能触发一次重读，因此这里只断言「确实请求过一次权限」，
  // 不把读取次数钉成 1；重复点击开关不应再产生新的权限请求。
  expect((await platformCounts(page)).request).toBe(1);
});

test('整棵假树在区域与文件夹两种模式下都保留多根、深链、重复、空文件夹、分隔符与坏地址', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);

  // —— 区域模式：全部浏览器根、完整路径、默认展开 ——
  await expect(page.getByRole('heading', { name: '书签栏', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '其他收藏夹', exact: true })).toBeVisible();
  // 根直属链接归入「未分类」，并保留根完整路径。区域视图只把**连续**的根直属链接
  // 包成同一段：中间被文件夹或分隔符打断时会出现多个同名 group，因此断言精确段数，
  // 再逐段检查内容与原顺序，而不是只取第一个。
  const bookmarksBarUncategorized = page.getByRole('group', { name: '未分类，书签栏', exact: true });
  await expect(bookmarksBarUncategorized).toHaveCount(3);
  await expect(bookmarksBarUncategorized.nth(0)).toContainText('根直链');
  await expect(bookmarksBarUncategorized.nth(1)).toContainText('重复链接');
  await expect(bookmarksBarUncategorized.nth(1)).toContainText('重复链接（副本）');
  await expect(bookmarksBarUncategorized.nth(2)).toContainText('坏地址');
  await expect(bookmarksBarUncategorized.nth(2)).toContainText('无地址书签');
  await expect(page.getByRole('group', { name: '未分类，其他收藏夹', exact: true })).toHaveCount(1);

  // 分段只做连续包裹，不改变浏览器原始顺序。
  const bookmarksBarSection = page.getByRole('region', { name: '书签栏 分组', exact: true });
  const sectionText = await bookmarksBarSection.innerText();
  const positions = ['根直链', '工作', '空文件夹', '坏地址', '无地址书签', '秘密书签']
    .map((label) => sectionText.indexOf(label));
  expect(positions.every((index) => index >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  await expect(bookmarkRow(page, '深层链接，书签，书签栏 / 工作 / 深层链接')).toBeVisible();
  await expect(bookmarkRow(page, '更深链接，书签，书签栏 / 工作 / 子层 / 更深链接')).toBeVisible();
  // 重复地址各占一行，不去重。
  await expect(bookmarkRow(page, '重复链接，书签，书签栏 / 重复链接')).toBeVisible();
  await expect(bookmarkRow(page, '重复链接（副本），书签，书签栏 / 重复链接（副本）')).toBeVisible();
  // 分隔符保留位置但不可交互：它是 role=separator，不是按钮。
  await expect(page.getByRole('separator', { name: '浏览器分隔线，不可操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: /分隔线/u })).toHaveCount(0);
  // 空文件夹默认展开，明确说明为空而不是静默跳过。
  await expect(page.getByText('此文件夹为空', { exact: true })).toBeVisible();
  // 坏地址与无地址仍是可见行，但明确标记不可打开。行按钮在 `aria-disabled` 时为 true，
  // Playwright 的可操作性检查会因此拒绝普通 click；这里用 `force` 绕过等待，明确验证
  // 「用户仍能点到这个按钮，但产品自身的守卫不会委托任何导航」。
  const bad = bookmarkRow(page, '坏地址，书签，书签栏 / 坏地址，地址不可用');
  const missing = bookmarkRow(page, '无地址书签，书签，书签栏 / 无地址书签，地址不可用');
  await expect(bad).toHaveAttribute('aria-disabled', 'true');
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
  await bad.click({ force: true });
  await missing.click({ force: true });
  expect((await platformCounts(page)).tabsUpdate).toBe(0);
  expect((await platformCounts(page)).tabsCreate).toBe(0);
  expect(await openedBookmarkUrls(page)).toEqual([]);

  // —— 文件夹模式：从全部根的直接子项开始，不预先展开深层 ——
  await switchMode(page, '文件夹');
  await expect(bookmarkRegion(page)).toBeVisible();
  await expect(page.getByText('全部浏览器根的直接子项', { exact: true })).toBeVisible();
  await expect(bookmarkRow(page, '根直链，书签，书签栏 / 根直链')).toBeVisible();
  await expect(bookmarkRow(page, '其他站点，书签，其他收藏夹 / 其他站点')).toBeVisible();
  await expect(bookmarkRow(page, '工作，文件夹，书签栏 / 工作')).toBeVisible();
  await expect(bookmarkRow(page, '深层链接，书签，书签栏 / 工作 / 深层链接')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: '浏览器分隔线，不可操作' })).toBeVisible();

  await bookmarkRow(page, '工作，文件夹，书签栏 / 工作').click();
  const dialog = folderDialog(page);
  await expect(dialog.getByRole('heading', { name: '工作', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '子层，文件夹，书签栏 / 工作 / 子层', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '子层', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', {
    name: '更深链接，书签，书签栏 / 工作 / 子层 / 更深链接', exact: true,
  })).toBeVisible();
  // 单层弹层：没有第二个宿主同时打开。
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('布局隐藏区域后仍可搜索，打开文件夹只出现唯一宿主弹层，书签仍可委托打开', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);

  await hideBookmarkRegion(page);
  await expect(bookmarkRegion(page)).toHaveCount(0);

  await searchBox(page).fill('工作');
  await bookmarkOption(page, '工作').first().click();
  const dialog = folderDialog(page);
  await expect(dialog.getByRole('heading', { name: '工作', exact: true })).toBeVisible();
  await expect(dialog).toContainText('深层链接');
  // 区域没有渲染，弹层只能来自布局外的 BookmarkFolderHost。
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await platformCounts(page)).toMatchObject({ tabsUpdate: 0, tabsCreate: 0 });

  await dialog.getByRole('button', { name: '关闭收藏夹文件夹', exact: true }).click();
  await expect(dialog).toBeHidden();

  await searchBox(page).fill('深层链接');
  const bookmark = bookmarkOption(page, '深层链接').first();
  await expect(bookmark).toContainText('浏览器书签');
  await bookmark.click();
  await expect.poll(async () => (await openedBookmarkUrls(page))[0]).toBe('https://deep.example/a');
  expect((await platformCounts(page)).tabsUpdate).toBe(1);
});

test('撤销权限立即清空区域与搜索，重新授权不自动重开旧文件夹弹层', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);

  await searchBox(page).fill('工作');
  await bookmarkOption(page, '工作').first().click();
  const dialog = folderDialog(page);
  await expect(dialog.getByRole('heading', { name: '工作', exact: true })).toBeVisible();
  // 弹层打开时 Base UI 模态会给主页内容的外层容器加 `aria-hidden="true"`（实测祖先链：
  // section[data-bookmark-region] → div.relative[aria-hidden=true] → main，inert 为 false），
  // 因此 `getByRole()` 走无障碍树看不到背景里的「书签栏」标题——元素仍在 DOM、仍在布局中，
  // 只是被模态从 a11y 树里摘掉。这里保留同一条「区域仍在主页渲染」的断言，只补上
  // `includeHidden` 以避免把模态造成的不可见误判成内容消失；`toBeVisible()` 仍要求它真的
  // 占位可见，所以不是放宽成「DOM 里有就算」。
  await expect(bookmarkRegion(page)).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '书签栏', exact: true, includeHidden: true }))
    .toBeVisible();

  // 明确撤销：事件到达即同步清空，不等 contains 复核。
  await emitBookmarkPermission(page, 'removed', ['bookmarks']);
  await expect(dialog).toBeHidden();
  // 撤销后的 0 必须来自元素卸载，而不是再次被 aria-hidden 遮掉，故同样带 includeHidden。
  await expect(page.getByRole('heading', { name: '书签栏', exact: true, includeHidden: true })).toHaveCount(0);
  await expect(bookmarkSection(page)).toContainText('需要重新允许读取收藏夹');

  // 撤销后书签不可搜索。
  await searchBox(page).fill('深层链接');
  await expect(results(page)).toBeVisible();
  await expect(results(page).getByRole('option').filter({ hasText: '浏览器书签' })).toHaveCount(0);

  // 重新授权：先写测试用权限标记，再从设置开关显式点击启用。
  await persistBookmarkPermission(page, true);
  const panel = await openBookmarkPanel(page);
  const toggle = enableSwitch(panel);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await closeSettings(page);

  await expect(page.getByRole('heading', { name: '书签栏', exact: true })).toBeVisible();
  // 旧 folderRequest 的 requestId 已被消费，不得自动重开弹层。
  await expect(folderDialog(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('打开被浏览器拒绝时给出可见通知，且不把书签地址带进提示', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);

  // 模拟原生拒绝，错误信息里故意带上地址与查询串，验证提示脱敏。
  await setBookmarkOpenFailure(page, `Refused to open ${BOOKMARK_SECRET_URL}`);
  await bookmarkRow(page, '秘密书签，书签，书签栏 / 秘密书签').click();

  const toast = page.locator('[data-slot="toast"]').filter({ hasText: '操作未完成' });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('浏览器拒绝了打开请求，请稍后重试');
  const text = await toast.innerText();
  expect(text).not.toContain('://');
  expect(text).not.toContain('secret-token-abc123');
  expect(text).not.toContain('leaked-secret');

  // 原始地址确实交给平台委托（tabs），只是没有展示在通知里。
  expect(await openedBookmarkUrls(page)).toEqual([BOOKMARK_SECRET_URL]);
  expect((await platformCounts(page)).tabsUpdate).toBe(1);
});

test('同一节点命中的多条隐藏规则在一次操作内全部恢复显示', async ({ page }) => {
  await installBookmarkPlatform(page, { granted: true });
  await openHome(page);
  // 直接写真实 Dexie 预置两条同节点规则并启用（不依赖任何产品 test hook）。
  // `openHome` 只保证 `<main>` 可见，首次安装的加载骨架屏同样是 `<main>`；`seedBookmarkPreferences`
  // 内部会先轮询到 `settings` / `app` 行真正落库再写，避免与首帧初始化竞争。
  await seedBookmarkPreferences(page, {
    enabled: true,
    hiddenRules: [
      {
        ruleId: 'rule-alpha', targetId: 'f-work', path: ['书签栏', '工作'],
        kind: 'folder', hidden: true, updatedAt: 1_700_000_000_000,
      },
      {
        ruleId: 'rule-beta', targetId: 'f-work', path: ['书签栏', '工作'],
        kind: 'folder', hidden: true, updatedAt: 1_700_000_000_001,
      },
    ],
  });
  await page.reload();
  await expect(bookmarkRegion(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: '书签栏', exact: true })).toBeVisible();
  // 两条规则都隐藏同一文件夹：它和后代都不渲染。
  await expect(bookmarkRow(page, '工作，文件夹，书签栏 / 工作')).toHaveCount(0);
  expect((await readBookmarkRules(page)).filter((rule) => rule.hidden)).toHaveLength(2);

  const panel = await openBookmarkPanel(page);
  const restore = panel.getByRole('button', { name: '恢复显示工作及其全部后代', exact: true });
  await expect(restore).toBeVisible();
  await restore.click();

  await expect.poll(async () => (await readBookmarkRules(page)).filter((rule) => rule.hidden).length).toBe(0);
  await expect(panel.getByRole('button', { name: '隐藏工作及其全部后代', exact: true })).toBeVisible();
  // 设置弹窗仍打开时主页区域处于 inert，page 级 locator 可能匹配不到；先关闭设置，
  // 再断言一次动作提交全部命中规则后该文件夹在区域中恢复显示。
  await closeSettings(page);
  await expect(bookmarkRow(page, '工作，文件夹，书签栏 / 工作')).toHaveCount(1);
});

/**
 * 跨页真实 Dexie 回归（同 origin 的第二个页面，不是第二个浏览器上下文）。
 *
 * 边界：仍然是受控假 `browser` 与普通 http 预览；两个页面共享同一 IndexedDB，
 * 因此这里验证的是「B 页用生产 UI 关闭后，设置行真的提交为 false，A 页收到并清空界面」。
 * 它不验证原生扩展的 `storage.local` 投递顺序，也不验证页面冻结/卸载后的补偿。
 */
test('另一活跃页关闭后，本页收到已提交的 false 并清空区域与搜索', async ({ page, context }) => {
  await installBookmarkPlatform(page, { granted: false, grantOnRequest: true });
  await openHome(page);
  await enableBookmarks(page);
  await expect(bookmarkSection(page)).toContainText('书签栏');

  // 第二个页面：同一浏览器上下文与 origin，共享 IndexedDB。
  const other = await context.newPage();
  await installBookmarkPlatform(other, { granted: false, grantOnRequest: true });
  await openHome(other);
  // 已在 A 页启用并授权：B 页直接从 Dexie 读到启用意图。
  await expect(other.locator('[data-bookmark-region]')).toBeVisible();
  await expect(other.getByRole('heading', { name: '书签栏', exact: true })).toBeVisible();

  // B 页用生产 UI 关闭收藏夹。
  const panel = await openBookmarkPanel(other);
  const toggle = enableSwitch(panel);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await closeSettings(other);

  // 真实 Dexie 设置行确实提交了 false（从 A 页读取同一数据库）。
  await expect.poll(() => readBookmarkPreferences(page)).toMatchObject({ enabled: false });

  // A 页是活跃页面，收到已提交的 false 后清空区域与书签搜索。
  await expect(bookmarkRegion(page)).toHaveCount(0);
  await searchBox(page).fill('深层链接');
  await expect(results(page).getByRole('option').filter({ hasText: '浏览器书签' })).toHaveCount(0);

  await other.close();
});
