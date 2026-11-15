import { expect, test, type Page } from '@playwright/test';

import { openAddMenu } from './form-helpers';

// 全部为普通网页预览（vite preview），不代表真实扩展、浏览器书签 API 或权限验收。
// 浏览器书签的启用、权限撤销、真实树与打开委托只能在真实扩展环境验收；
// 这里验证不依赖书签 API 的部分：自有文件夹完整路径进入搜索、结果可激活、
// 未接入书签时不出现书签类别或过期标记，且输入期间零外部网络请求。
const DESKTOP = { width: 1440, height: 1000 };
const BOOKMARK_DETAIL = '浏览器书签 · ';

function searchBox(page: Page) {
  return page.getByRole('textbox', { name: '搜索', exact: true });
}

function results(page: Page) {
  return page.getByRole('listbox', { name: '搜索结果', exact: true });
}

function option(page: Page, text: string) {
  return results(page).getByRole('option').filter({ hasText: text });
}

async function createFolder(page: Page, name: string) {
  await openAddMenu(page, '新建文件夹');
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await dialog.getByLabel('文件夹名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  return page.locator('[data-folder-tile]').filter({ hasText: name });
}

async function addWebsite(page: Page, container: ReturnType<Page['getByRole']>, name: string) {
  await container.getByRole('button', { name: '添加网站', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站', exact: true });
  await form.getByLabel('名称', { exact: true }).fill(name);
  await form.getByLabel('网址', { exact: true }).fill('https://frontend.example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
}

test('自有文件夹与其中的网站以完整路径进入搜索，激活文件夹进入对应层级', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '开发资料');
  await tile.click();
  const dialog = page.getByRole('dialog', { name: '开发资料', exact: true });
  await addWebsite(page, dialog, '组件库');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const input = searchBox(page);
  await input.fill('组件库');
  const site = results(page).getByRole('option').filter({ hasText: '主页 / 开发资料' });
  await expect(site).toBeVisible();
  // 详情必须是「主页 / 开发资料 · 地址」，不能只显示直接父名或裸来源。
  await expect(site).toContainText('主页 / 开发资料 · https://frontend.example.com');

  await input.fill('开发资料');
  const folder = results(page).getByRole('option').filter({ hasText: '打开文件夹「开发资料」' });
  await expect(folder).toContainText('本地文件夹 · 主页 / 开发资料');
  await folder.click();
  const navigated = page.getByRole('dialog', { name: '开发资料', exact: true });
  await expect(navigated).toBeVisible();
  await expect(navigated).toContainText('1 个网站');
});

test('未接入浏览器书签时不产生书签结果或过期标记，输入期间不请求外部网络', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/newtab.html');
  const tile = await createFolder(page, '工作');
  await tile.click();
  const dialog = page.getByRole('dialog', { name: '工作', exact: true });
  await addWebsite(page, dialog, '项目站');
  await page.keyboard.press('Escape');

  const input = searchBox(page);
  await expect(input).toBeVisible();
  // 只统计「输入期间」的请求：页面打开阶段的环境注入（例如本机安全软件往浏览器注入
  // 的脚本）不属于应用行为，等待其完成后才开始记录，断言才对应真实范围。
  await page.waitForLoadState('networkidle');
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5173/')) external.push(request.url());
  });

  for (const query of ['工作', '项目站', '浏览器书签', '书签栏']) {
    await input.fill(query);
    await expect(results(page)).toBeVisible();
    // 普通网页预览没有书签提供方：不能出现书签详情行或过期标注占位。
    await expect(results(page).getByText(BOOKMARK_DETAIL, { exact: false })).toHaveCount(0);
    await expect(results(page).getByText('上次读取', { exact: false })).toHaveCount(0);
  }
  // 循环最后一次停在「书签栏」，回到网站名再断言完整路径，避免用空结果断言内容。
  await input.fill('项目站');
  await expect(results(page).getByRole('option').filter({ hasText: '主页 / 工作' })).toContainText('项目站');
  expect(external).toEqual([]);
});
