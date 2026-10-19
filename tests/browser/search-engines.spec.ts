import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/newtab.html'); });

test('自定义搜索引擎可新增、设为默认并删除', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸与背景', exact: true }).click();
  await page.getByRole('button', { name: '新建壁纸', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await page.getByRole('button', { name: '管理自定义搜索引擎', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('Ecosia');
  await page.getByLabel('HTTPS 搜索模板').fill('https://www.ecosia.org/search?q={query}');
  await page.getByRole('button', { name: '添加搜索引擎' }).click();
  await expect(page.getByRole('textbox', { name: 'Ecosia 名称', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await selectSettingsEngine(page, 'Ecosia');
  await page.getByRole('button', { name: '管理自定义搜索引擎', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除 Ecosia' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '壁纸与背景', exact: true }).click();
  await page.getByRole('button', { name: '新建壁纸', exact: true }).click();
  await page.getByRole('tab', { name: '搜索' }).click();
  await expect(page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button')).toContainText('Ecosia');
  await selectSettingsEngine(page, 'Google');
  await page.getByRole('button', { name: '管理自定义搜索引擎', exact: true }).click();
  await page.getByRole('button', { name: '删除 Ecosia' }).click();
  await expect(page.getByRole('textbox', { name: 'Ecosia 名称', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button').click();
  await expect(page.getByRole('menuitemradio', { name: 'Ecosia', exact: true })).toHaveCount(0);
});

async function selectSettingsEngine(page: import('@playwright/test').Page, name: string) {
  const picker = page.getByRole('group', { name: '默认搜索引擎' }).getByRole('button');
  await picker.click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(picker).toContainText(name);
}

async function openManagement(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: '管理自定义搜索引擎', exact: true }).click();
}

test('编辑引擎名称、模板和关键词后重载保留，并正确编码本次查询', async ({ page }) => {
  await openManagement(page);
  await page.getByLabel('名称', { exact: true }).fill('Docs');
  await page.getByLabel('HTTPS 搜索模板', { exact: true }).fill('https://example.test/?q={query}');
  await page.getByRole('button', { name: '添加搜索引擎', exact: true }).click();
  const row = page.getByRole('region', { name: 'Docs 搜索设置', exact: true });
  await row.getByRole('textbox', { name: 'Docs 名称' }).fill('Docs Plus');
  await row.getByRole('textbox', { name: 'Docs HTTPS 搜索模板' }).fill('https://example.test/?q={query}&from=orinui');
  await row.getByRole('button', { name: '保存搜索引擎', exact: true }).click();
  const updated = page.getByRole('region', { name: 'Docs Plus 搜索设置', exact: true });
  await updated.getByRole('textbox', { name: 'Docs Plus 搜索关键词' }).fill('docs');
  await updated.getByRole('button', { name: '保存关键词', exact: true }).click();
  await expect(updated.getByRole('status')).toHaveText('已保存');
  await page.reload();
  await openManagement(page);
  await expect(updated.getByRole('textbox', { name: 'Docs Plus HTTPS 搜索模板' }))
    .toHaveValue('https://example.test/?q={query}&from=orinui');
  await expect(updated.getByRole('textbox', { name: 'Docs Plus 搜索关键词' })).toHaveValue('docs');
  await page.getByRole('button', { name: '返回搜索', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.route('https://example.test/**', (route) => route.fulfill({ status: 200, body: 'navigation fixture' }));
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await input.fill('docs a&b');
  await expect(page.getByRole('option')).toContainText('用 Docs Plus 搜索');
  await input.press('Enter');
  await expect(page).toHaveURL('https://example.test/?q=a%26b&from=orinui');
});

