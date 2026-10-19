import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUTPUT = resolve('.output/search-audit');
const EXTENSION = resolve('.output/chrome-mv3');
const VIEWPORT = { width: 1440, height: 960 };
const SEARCH_NAME = { name: '搜索', exact: true };

function search(page) { return page.getByRole('textbox', SEARCH_NAME); }
function options(page) { return page.getByRole('listbox', { name: '搜索结果' }).getByRole('option'); }

async function query(page, text, label) {
  await search(page).fill(text);
  const item = options(page).filter({ hasText: label }).first();
  await expect(item).toBeVisible();
  return item;
}

async function settings(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
}

async function auditTools(page) {
  await (await query(page, 'gh clone octo/project', '复制 HTTPS clone 命令')).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('git clone https://github.com/octo/project.git');
  await (await query(page, 'rgba(255, 0, 0, 0.5)', '复制 HEX')).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('#ff000080');
  await query(page, '对比度 rgba(0, 0, 0, 0.5) #fff', '3.98:1');
  await expect(page.getByLabel('文字对比预览')).toBeVisible();
  await query(page, '日期 2026-10-19 + 7天', '2026-10-26');
  await query(page, 'unix:1700000000', '复制 ISO');
  await query(page, '2026-10-19T09:00:00+08:00 to Asia/Tokyo', 'Asia/Tokyo');
  await page.screenshot({ path: `${OUTPUT}/tools.png` });
  await query(page, 'gh owner/repo#oops', 'GitHub 命令无效');
  await expect(options(page)).toHaveCount(1);
  await query(page, 'owner/repo#123', '用 Google 搜索');
  await expect(options(page).filter({ hasText: '打开 GitHub' })).toHaveCount(0);
  await query(page, '日期 2026-02-30 + 1天', '日期时间格式无效');
  await search(page).press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(search(page)).toHaveValue('日期 2026-02-30 + 1天');
  await search(page).press('Escape');
  await expect(search(page)).toHaveValue('');
}

async function auditAppearance(page) {
  await settings(page);
  await page.getByRole('button', { name: '胶囊', exact: true }).click();
  await expect(page.getByRole('button', { name: '胶囊', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '手动', exact: true }).click();
  const slider = page.getByRole('slider', { name: '搜索框背景不透明度' });
  await slider.focus();
  await page.keyboard.press('Home');
  await page.getByRole('textbox', { name: '提示文字' }).fill('扩展内本地搜索');
  await page.getByRole('textbox', { name: '提示文字' }).blur();
  await page.screenshot({ path: `${OUTPUT}/settings.png` });
  await page.keyboard.press('Escape');
  await expect(search(page)).toHaveAttribute('placeholder', '扩展内本地搜索');
  await expect(search(page).locator('..')).toHaveCSS('border-radius', '24px');
  await expect(search(page).locator('..')).toHaveCSS('background-color', /\/ 0\)/);
  await page.reload();
  await expect(search(page)).toHaveAttribute('placeholder', '扩展内本地搜索');
  await expect(search(page).locator('..')).toHaveCSS('background-color', /\/ 0\)/);
}

async function auditKeywords(page) {
  await settings(page);
  await page.getByRole('button', { name: '管理自定义搜索引擎' }).click();
  const google = page.getByRole('region', { name: 'Google 搜索设置' });
  await google.getByRole('textbox', { name: 'Google 搜索关键词' }).fill('g');
  await google.getByRole('button', { name: '保存关键词' }).click();
  await expect(google.getByRole('status')).toHaveText('已保存');
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.keyboard.press('Escape');
  const picker = page.getByRole('button', { name: '选择搜索引擎' });
  await picker.click();
  await page.getByRole('menuitemradio', { name: 'Bing', exact: true }).click();
  await query(page, 'g react', '用 Google 搜索');
  await expect(options(page)).toHaveCount(1);
  await expect(picker).toHaveAttribute('title', '搜索引擎：Bing');
  await query(page, 'react', '用 Bing 搜索');
}

async function auditOfflineIndex(page, context) {
  await search(page).press('Escape');
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await dialog.getByLabel('文件夹名称').fill('搜索资料');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();
  await context.setOffline(true);
  await query(page, 'sousuoziliao', '搜索资料');
  await query(page, 'sszl', '搜索资料');
  await page.reload();
  await query(page, 'sszl', '搜索资料');
  await context.setOffline(false);
}

async function auditNavigation(page, extensionUrl) {
  let destination;
  await page.route('https://github.com/**', async (route) => {
    destination = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Navigation test fixture</title>' });
  });
  await query(page, 'gh owner/repo#123', '打开 GitHub Issue 或 PR');
  await search(page).press('Enter');
  await expect(page).toHaveURL('https://github.com/owner/repo/issues/123');
  expect(destination).toBe('https://github.com/owner/repo/issues/123');
  await page.goto(extensionUrl);
  return destination;
}

async function runAudit() {
  await mkdir(OUTPUT, { recursive: true });
  const profile = await mkdtemp('/tmp/orinui-search-extension-');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true,
    viewport: VIEWPORT, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`] });
  try {
    return await auditContext(context);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

async function auditContext(context) {
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  context.on('request', (request) => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await page.goto('chrome://newtab');
  await expect(search(page)).toBeVisible();
  const extensionUrl = page.url();
  expect(extensionUrl).toMatch(/^chrome-extension:\/\//);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await auditTools(page);
  await auditAppearance(page);
  await auditKeywords(page);
  await auditOfflineIndex(page, context);
  expect(externalRequests).toEqual([]);
  const destination = await auditNavigation(page, extensionUrl);
  expect(pageErrors).toEqual([]);
  const report = { status: 'passed', extensionUrl, chromeVersion: context.browser()?.version(),
    checks: ['tool previews', 'clipboard', 'gh prefix', 'invalid dates', 'Escape', 'appearance persistence',
      'one-shot keywords', 'offline pinyin index', 'zero input network requests', 'explicit navigation'],
    externalRequestsBeforeNavigation: 0, destination, pageErrors };
  await writeFile(`${OUTPUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

await runAudit();
