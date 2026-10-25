import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAddMenu } from './form-helpers';

function searchBox(page: Page) {
  return page.getByRole('textbox', { name: '搜索', exact: true });
}

function results(page: Page) {
  return page.getByRole('listbox', { name: '搜索结果', exact: true });
}

async function expectOptions(page: Page, query: string, labels: readonly string[]) {
  const input = searchBox(page);
  await input.fill(query);
  const list = results(page);
  for (const label of labels) await expect(list.getByRole('option').filter({ hasText: label }).first()).toBeVisible();
  return list;
}

async function expectInvalidGh(page: Page, query: string) {
  const list = await expectOptions(page, query, ['GitHub 命令无效']);
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByText('用 Google 搜索', { exact: false })).toHaveCount(0);
}

async function openSearchSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
}

async function createFolder(page: Page, name: string): Promise<Locator> {
  await openAddMenu(page, '新建文件夹');
  const form = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await form.getByLabel('文件夹名称', { exact: true }).fill(name);
  await form.getByRole('button', { name: '创建', exact: true }).click();
  await expect(form).toBeHidden();
  return page.locator('[data-folder-tile]').filter({ hasText: name });
}

async function addWebsite(page: Page, name: string) {
  const folder = page.getByRole('dialog', { name: '搜索夹', exact: true });
  await folder.getByRole('button', { name: '添加网站', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加网站', exact: true });
  await form.getByLabel('名称', { exact: true }).fill(name);
  await form.getByLabel('网址', { exact: true }).fill('https://example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  await expect(folder.getByRole('link', { name, exact: true })).toBeVisible();
}

test('GitHub 命令覆盖帮助、仓库、Issue、搜索、完整 Release 与 clone', async ({ page }) => {
  await page.goto('/newtab.html');
  const cases = [
    ['gh', 'gh owner/repo'], ['gh help', 'gh owner/repo'], ['gh octo/project', '打开仓库'],
    ['gh octo/project#123', '打开 GitHub Issue 或 PR'],
    ['gh code octo/project auth token', '搜索仓库 octo/project 的 code'],
    ['gh issues octo/project state:open bug', '搜索仓库 octo/project 的 issues'],
    ['gh prs octo/project bug', '搜索仓库 octo/project 的 prs'], ['gh search react', '搜索 GitHub repositories'],
    ['gh releases octo/project', '查看所有 Releases'], ['gh clone octo/project', '复制 HTTPS clone 命令'],
  ] as const;
  for (const [query, label] of cases) await expectOptions(page, query, [label]);
});

test('GitHub 命令错误显式显示，非法参数与裸 repo# 不伪装成 GitHub Issue', async ({ page }) => {
  await page.goto('/newtab.html');
  for (const query of ['gh nonsense', 'gh repo octo/project', 'gh issue octo/project#123', 'gh pr octo/project#123',
    'gh code', 'gh issues', 'gh releases octo/project all', 'gh clone octo/project extra',
    'gh compare octo/project main...feature']) {
    await expectInvalidGh(page, query);
  }
  for (const query of ['octo/project#123', 'octo/project#']) {
    const list = await expectOptions(page, query, ['用 Google 搜索']);
    await expect(list.getByRole('option').filter({ hasText: '打开 GitHub Issue 或 PR' })).toHaveCount(0);
  }
});

test('仓库动作与 clone 提供多种操作，复制 HTTPS 和 SSH 命令', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const repo = await expectOptions(page, 'gh octo/project', ['在仓库内搜索代码', '复制 HTTPS clone 命令', '复制 SSH clone 命令']);
  await expect(repo.getByRole('option')).toHaveCount(7);
  await repo.getByRole('option').filter({ hasText: '复制 HTTPS clone 命令' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('git clone https://github.com/octo/project.git');

  const clone = await expectOptions(page, 'gh clone octo/project', ['复制 HTTPS clone 命令', '复制 SSH clone 命令']);
  await expect(clone.getByRole('option')).toHaveCount(2);
  await clone.getByRole('option').filter({ hasText: '复制 SSH clone 命令' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('git clone git@github.com:octo/project.git');
});

test('clone 剪贴板拒绝时显示真实错误', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async () => { throw new Error('clipboard-write-blocked'); } } }));
  await page.goto('/newtab.html');
  const list = await expectOptions(page, 'gh clone octo/project', ['复制 HTTPS clone 命令']);
  await list.getByRole('option').filter({ hasText: '复制 HTTPS clone 命令' }).click();
  await expect(page.getByText('操作未完成', { exact: true })).toBeVisible();
  await expect(page.getByText('clipboard-write-blocked', { exact: true })).toBeVisible();
});

test('搜索引擎关键词只路由当前查询，不修改默认引擎', async ({ page }) => {
  await page.goto('/newtab.html');
  await openSearchSettings(page);
  await page.getByRole('button', { name: '管理搜索引擎' }).click();
  await page.getByRole('button', { name: 'Google 搜索引擎设置', exact: true }).click();
  const google = page.getByRole('region', { name: 'Google 搜索设置' });
  await google.getByRole('textbox', { name: 'Google 快捷词' }).fill('g');
  await google.getByRole('button', { name: '保存快捷词' }).click();
  await expect(google.getByRole('status')).toHaveText('已保存');
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.keyboard.press('Escape');

  const picker = page.getByRole('button', { name: '选择搜索引擎' });
  await picker.click();
  await page.getByRole('menuitemradio', { name: 'Bing', exact: true }).click();
  const list = await expectOptions(page, 'g hello', ['用 Google 搜索']);
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option').first()).toContainText('hello');
  await expect(picker).toHaveAttribute('title', '搜索引擎：Bing');
  await expectOptions(page, 'ordinary query', ['用 Bing 搜索']);
  await expect(picker).toHaveAttribute('title', '搜索引擎：Bing');
});

test('明确网址可直达，2.3 与裸地址样式文本保留普通搜索', async ({ page }) => {
  await page.goto('/newtab.html');
  const direct = await expectOptions(page, 'https://example.org/path?q=ok', ['打开网址']);
  await expect(direct.getByRole('option').filter({ hasText: '打开网址' })
    .filter({ hasText: 'https://example.org/path?q=ok' })).toBeVisible();
  for (const query of ['2.3', 'owner/repo#123', 'owner/repo#']) {
    const list = await expectOptions(page, query, ['用 Google 搜索']);
    await expect(list.getByRole('option').filter({ hasText: '打开网址' })).toHaveCount(0);
    await expect(list.getByRole('option').filter({ hasText: '打开 GitHub Issue 或 PR' })).toHaveCount(0);
  }
});

test('颜色结果显示预览并可复制 HEX、RGB、HSL', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const list = await expectOptions(page, '#336699', ['复制 HEX', '复制 RGB', '复制 HSL']);
  await expect(list.getByLabel('颜色 #336699')).toHaveCount(3);
  await expect(list.getByLabel('颜色 #336699').first()).toBeVisible();
  const formats = [['HEX', '#336699'], ['RGB', 'rgb(51 102 153)'], ['HSL', 'hsl(210 50% 40%)']] as const;
  for (const [format, copied] of formats) {
    await list.getByRole('option').filter({ hasText: `复制 ${format}` }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(copied);
  }
});

test('ts now 提供本地、ISO、Unix 秒和毫秒，中文日期差返回天数', async ({ page }) => {
  const instant = new Date('2026-10-19T03:04:05.000Z');
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const now = await expectOptions(page, 'ts now', ['复制本地时间', '复制 ISO 8601', '复制 Unix 秒', '复制 Unix 毫秒']);
  await expect(now.getByRole('option')).toHaveCount(4);
  await now.getByRole('option').filter({ hasText: '复制 ISO 8601' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('2026-10-19T03:04:05.000Z');

  const difference = await expectOptions(page, '日期差 2026-10-01 2026-10-19', ['复制相差天数']);
  await difference.getByRole('option').filter({ hasText: '复制相差天数' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('18');
});

test('问号示例仅填入输入框，不执行导航', async ({ page }) => {
  await page.goto('/newtab.html');
  const input = searchBox(page);
  const pageUrl = page.url();
  await input.fill('?');
  const examples = await expectOptions(page, '?', ['gh owner/repo', '颜色', '日期与时间']);
  await examples.getByText('示例：颜色 hsl(210 50% 40%)', { exact: true }).click();
  await expect(input).toHaveValue('颜色 hsl(210 50% 40%)');
  await expect(page).toHaveURL(pageUrl);
  await input.fill('?');
  await examples.getByRole('option').filter({ hasText: '日期与时间' }).first().click();
  await expect(input).toHaveValue('ts now');
  await expect(page).toHaveURL(pageUrl);
  await input.fill('?');
  await examples.getByText('示例：gh owner/repo', { exact: true }).click();
  await expect(input).toHaveValue('gh owner/repo');
  await expect(page).toHaveURL(pageUrl);
});

test('IME composing 与 keyCode 229 时 Enter 不执行当前搜索动作', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
  const input = searchBox(page);
  await input.fill('=2+2');
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    (element as HTMLInputElement).form?.requestSubmit();
  });
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged');
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, which: 229, bubbles: true, cancelable: true }));
    (element as HTMLInputElement).form?.requestSubmit();
  });
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged');
  await expect(page).toHaveURL(/\/newtab\.html$/);
});

test('输入命令和普通查询时不发起 GitHub 或搜索服务请求', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(url.href);
  });
  await page.goto('/newtab.html');
  const queries = [
    ['gh octo/project', '打开仓库'], ['gh clone octo/project', '复制 HTTPS clone 命令'],
    ['ordinary search phrase', '用 Google 搜索'], ['#336699', '复制 HEX'], ['?', 'gh owner/repo'],
  ] as const;
  for (const [query, label] of queries) await expectOptions(page, query, [label]);
  expect(externalRequests).toEqual([]);
});

test('Esc 收起后 Enter 先展示结果，不执行隐藏的复制选择', async ({ page }) => {
  await page.goto('/newtab.html');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
  await queryEscapeSelection(page);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged');
  await expect(results(page)).toBeVisible();
});

async function queryEscapeSelection(page: Page) {
  const input = searchBox(page);
  await expectOptions(page, '#336699', ['复制 RGB']);
  await input.press('ArrowDown');
  await input.press('Escape');
  await expect(results(page)).toBeHidden();
  await input.press('Enter');
}

test('本地网站和文件夹支持中文全拼、首拼并分别受来源开关控制', async ({ page }) => {
  await page.goto('/newtab.html');
  const folderTile = await createFolder(page, '搜索夹');
  await folderTile.click();
  await addWebsite(page, '微信');
  await page.keyboard.press('Escape');
  const input = searchBox(page);
  for (const query of ['weixin', 'wx']) {
    const list = await expectOptions(page, query, ['微信']);
    await expect(list.getByRole('option').filter({ hasText: '微信' })).toBeVisible();
  }
  for (const query of ['sousuo jia', 'ssj']) {
    const list = await expectOptions(page, query, ['搜索夹']);
    await expect(list.getByRole('option').filter({ hasText: '打开文件夹「搜索夹」' })).toBeVisible();
  }

  await openSearchSettings(page);
  const showSites = page.getByRole('switch', { name: '显示网站结果' });
  await showSites.click();
  await expect(showSites).not.toBeChecked();
  await page.keyboard.press('Escape');
  await input.fill('weixin');
  await expect(results(page).getByRole('option').filter({ hasText: '微信' })).toHaveCount(0);
  await input.fill('sousuo jia');
  await expect(results(page).getByRole('option').filter({ hasText: '打开文件夹「搜索夹」' })).toBeVisible();

  await openSearchSettings(page);
  const showFolders = page.getByRole('switch', { name: '显示文件夹结果' });
  await showFolders.click();
  await expect(showFolders).not.toBeChecked();
  await page.keyboard.press('Escape');
  await input.fill('sousuo jia');
  await expect(results(page).getByRole('option').filter({ hasText: '打开文件夹「搜索夹」' })).toHaveCount(0);
});
